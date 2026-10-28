#!/usr/bin/env python3
"""Convert the public WordPress entries in liceulon_db.sql to an EmDash seed."""

from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import unicodedata
from urllib.parse import urljoin, urlsplit


SITE_ORIGIN = "https://www.liceul-onisifor-ghibu.ro"
POST_TYPE_COLLECTION = {
    "page": "pages",
    "post": "announcements",
    "learncare_courses": "courses",
    "learncare_events": "events",
    "learncare_teachers": "teachers",
}
COLLECTION_LABELS = {
    "pages": ("Pagini", "Pagină", "/{slug}"),
    "announcements": ("Anunțuri", "Anunț", "/noutati/{slug}"),
    "courses": ("Programe și cursuri", "Program", "/programe/{slug}"),
    "events": ("Evenimente", "Eveniment", "/evenimente/{slug}"),
    "teachers": ("Profesori", "Profesor", "/profesori/{slug}"),
}
FORM_SHORTCODES = {
    "contact-form-7": "contact",
    "learncare_welcome_form": "welcome",
}
PLACEHOLDER_SLUGS = {
    "pages": {
        "sample-page",
        "home-1",
        "home-2",
        "home-3",
        "blog-classic",
        "blog-grid",
        "about-style-one",
        "about-style-two",
        "event-style-one",
        "event-list-style",
        "teachers-style-one",
        "teachers-style-two",
        "teachers-column-4",
        "teacher-style-one",
        "courses-style-two",
        "gallery-fullwidth",
        "gallery-masonry",
        "gallery-standard",
        "gallery-with-title",
        "contact-one",
        "contact-two",
        "asdadad",
        "pagina-exemplu",
    },
    "announcements": {
        "hello-world",
        "praesent-aliquam-velit-at-tortor",
        "praesent-aliquam-velit-at-tortor-2",
        "praesent-aliquam-velit-at-tortor-3",
        "nunc-condimentum-nec-erat",
        "euismod-non-interdum-id",
        "donec-est-nibh-euismod-non",
        "salut-lume",
    },
    "courses": {
        "creative-web-design",
        "58-2",
        "vivamus-consequat-est-id-turpis",
        "donec-ullamcorper",
        "nec-placerat-sem",
        "donec-est-nibh",
    },
    "events": {
        "64-2",
        "the-legacy-of-generations",
        "eleifend-mattis-lorem-sagittis",
        "donec-est-nibh",
        "tortor-rutrum-luc",
        "non-interdum-id",
    },
    "teachers": {
        "margaret-thomas",
        "jesical-alba",
        "thomas-jesica",
        "vestibulum-ante",
        "morbi-nisl-enim",
        "faucibus-lacus",
        "pellentesque-eget",
        "ligula-ullamcorper",
    },
}
MYSQL_ESCAPES = {
    "0": "\0",
    "b": "\b",
    "n": "\n",
    "r": "\r",
    "t": "\t",
    "Z": "\x1a",
}


def parse_mysql_insert(statement: str) -> tuple[str, list[str], list[list[str | None]]]:
    header = re.match(
        r"INSERT INTO `([^`]+)`\s*\((.*?)\)\s*VALUES\s*(.*);\s*$",
        statement,
        re.DOTALL,
    )
    if not header:
        raise ValueError("Malformed INSERT statement in WordPress export")

    table = header.group(1)
    columns = re.findall(r"`([^`]+)`", header.group(2))
    values = header.group(3)
    rows: list[list[str | None]] = []
    i = 0

    while i < len(values):
        while i < len(values) and values[i] not in "(":
            i += 1
        if i >= len(values):
            break
        i += 1
        row: list[str | None] = []

        while i < len(values):
            while i < len(values) and values[i].isspace():
                i += 1
            if i >= len(values):
                raise ValueError(f"Unterminated row in {table} INSERT")

            if values[i] == "'":
                i += 1
                cell: list[str] = []
                while i < len(values):
                    char = values[i]
                    if char == "\\" and i + 1 < len(values):
                        escaped = values[i + 1]
                        cell.append(MYSQL_ESCAPES.get(escaped, escaped))
                        i += 2
                        continue
                    if char == "'":
                        if i + 1 < len(values) and values[i + 1] == "'":
                            cell.append("'")
                            i += 2
                            continue
                        i += 1
                        break
                    cell.append(char)
                    i += 1
                else:
                    raise ValueError(f"Unterminated string in {table} INSERT")
                row.append("".join(cell))
            else:
                start = i
                while i < len(values) and values[i] not in ",)":
                    i += 1
                literal = values[start:i].strip()
                row.append(None if literal.upper() == "NULL" else literal)

            while i < len(values) and values[i].isspace():
                i += 1
            if i < len(values) and values[i] == ",":
                i += 1
                continue
            if i < len(values) and values[i] == ")":
                i += 1
                rows.append(row)
                break
            if i >= len(values):
                raise ValueError(f"Unterminated row in {table} INSERT")

    for row in rows:
        if len(row) != len(columns):
            raise ValueError(f"Column count mismatch in {table} INSERT")
    return table, columns, rows


def insert_statements(path: Path):
    buffer: list[str] = []
    with path.open("r", encoding="utf-8", errors="replace") as source:
        for line in source:
            if not buffer and line.startswith("INSERT INTO `"):
                buffer.append(line)
            elif buffer:
                buffer.append(line)
            if buffer and line.rstrip().endswith(";"):
                yield "".join(buffer)
                buffer = []
    if buffer:
        raise ValueError("WordPress SQL export ended inside an INSERT statement")


def slugify(value: str, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii").lower()
    result = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")
    return result or fallback


def stable_key(prefix: str, number: int) -> str:
    return f"{prefix}-{number:04d}"


def media_url(source: str | None, uploads: Path) -> str | None:
    if not source:
        return None
    absolute = urljoin(SITE_ORIGIN + "/", source)
    parsed = urlsplit(absolute)
    marker = "/wp-content/uploads/"
    path = parsed.path
    if marker not in path:
        return absolute
    relative = path.split(marker, 1)[1]
    local_path = uploads.joinpath(*relative.split("/"))
    if local_path.is_file():
        return marker + relative
    return absolute


class PortableTextParser(HTMLParser):
    block_tags = {
        "p": "normal",
        "h1": "h2",
        "h2": "h2",
        "h3": "h3",
        "h4": "h4",
        "h5": "h5",
        "h6": "h6",
        "blockquote": "blockquote",
        "pre": "code",
    }

    def __init__(self, uploads: Path):
        super().__init__(convert_charrefs=True)
        self.uploads = uploads
        self.blocks: list[dict] = []
        self.current: dict | None = None
        self.marks: list[tuple[str, str | None]] = []
        self.list_stack: list[str] = []
        self.sequence = 0

    def key(self, prefix: str = "block") -> str:
        self.sequence += 1
        return stable_key(prefix, self.sequence)

    def begin(self, style: str = "normal", list_item: str | None = None):
        self.finish()
        self.current = {
            "_type": "block",
            "_key": self.key(),
            "style": style,
            "children": [],
        }
        if list_item:
            self.current["listItem"] = list_item

    def ensure_current(self):
        if self.current is None:
            self.begin()

    def finish(self):
        if not self.current:
            return
        children = self.current["children"]
        while children and not children[0].get("text", "").strip():
            children.pop(0)
        while children and not children[-1].get("text", "").strip():
            children.pop()
        if children:
            self.blocks.append(self.current)
        self.current = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        attributes = dict(attrs)
        if tag in self.block_tags:
            self.begin(self.block_tags[tag])
        elif tag in ("ul", "ol"):
            self.list_stack.append("number" if tag == "ol" else "bullet")
        elif tag == "li":
            list_style = self.list_stack[-1] if self.list_stack else "bullet"
            self.begin("normal", list_style)
        elif tag in ("strong", "b"):
            self.marks.append(("strong", None))
        elif tag in ("em", "i"):
            self.marks.append(("em", None))
        elif tag in ("s", "del", "strike"):
            self.marks.append(("strike-through", None))
        elif tag == "code":
            self.marks.append(("code", None))
        elif tag == "a":
            href = attributes.get("href")
            if href:
                mark_key = self.key("link")
                self.current_mark_defs[mark_key] = {
                    "_key": mark_key,
                    "_type": "link",
                    "href": href,
                }
                self.marks.append((mark_key, "a"))
        elif tag == "br":
            self.add_text("\n")
        elif tag == "img":
            source = attributes.get("src") or attributes.get("data-src")
            if source:
                self.finish()
                resolved = media_url(source, self.uploads)
                self.blocks.append(
                    {
                        "_type": "wordpressImage",
                        "_key": self.key("image"),
                        "src": resolved,
                        "alt": attributes.get("alt") or "",
                    }
                )

    @property
    def current_mark_defs(self) -> dict[str, dict]:
        if self.current is None:
            self.begin()
        return self.current.setdefault("markDefs", {})

    def handle_endtag(self, tag: str):
        if tag in self.block_tags or tag == "li":
            self.finish()
        elif tag in ("ul", "ol") and self.list_stack:
            self.list_stack.pop()
        elif tag in ("strong", "b"):
            self.pop_mark("strong")
        elif tag in ("em", "i"):
            self.pop_mark("em")
        elif tag in ("s", "del", "strike"):
            self.pop_mark("strike-through")
        elif tag == "code":
            self.pop_mark("code")
        elif tag == "a":
            self.pop_mark("a")

    def pop_mark(self, target: str):
        for index in range(len(self.marks) - 1, -1, -1):
            name, _ = self.marks[index]
            if name == target or (target == "a" and name.startswith("link-")):
                self.marks.pop(index)
                return

    def add_text(self, text: str):
        if not text:
            return
        self.ensure_current()
        marks = [name for name, _ in self.marks]
        self.current["children"].append(
            {"_type": "span", "_key": self.key("span"), "text": text, "marks": marks}
        )

    def handle_data(self, data: str):
        self.add_text(data)


def portable_text(markup: str, uploads: Path) -> list[dict]:
    markup = re.sub(r"<!--.*?-->", "", markup, flags=re.DOTALL)
    markup = re.sub(r"\[(?:/?[a-zA-Z0-9_-]+)(?:[^\]]*)\]", " ", markup)
    parser = PortableTextParser(uploads)
    parser.feed(markup)
    parser.close()
    parser.finish()
    return parser.blocks


def form_kind(markup: str) -> str:
    for shortcode, kind in FORM_SHORTCODES.items():
        if re.search(r"\[\s*" + re.escape(shortcode) + r"\b", markup, re.IGNORECASE):
            return kind
    return ""


def field(slug: str, label: str, field_type: str, **extra) -> dict:
    return {"slug": slug, "label": label, "type": field_type, **extra}


def collection_schema(slug: str) -> dict:
    label, singular, url_pattern = COLLECTION_LABELS[slug]
    supports = ["drafts", "revisions", "preview", "search", "seo"]
    fields = [
        field("title", "Titlu", "string", required=True, searchable=True),
        field("excerpt", "Rezumat", "text", searchable=True),
        field("content", "Conținut", "portableText", searchable=True),
        field("featured_image_url", "Imagine reprezentativă", "url"),
        field("source_url", "URL WordPress original", "url"),
        field("source_id", "ID WordPress", "string"),
        field("source_date", "Data publicării originale", "datetime"),
    ]
    if slug == "pages":
        fields.extend(
            [
                field("has_form", "Conține un formular", "boolean"),
                field("form_kind", "Tip formular", "string"),
            ]
        )
    return {
        "slug": slug,
        "label": label,
        "labelSingular": singular,
        "urlPattern": url_pattern,
        "supports": supports,
        "fields": fields,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sql", type=Path, required=True, help="Path to the WordPress SQL export")
    parser.add_argument("--uploads", type=Path, required=True, help="WordPress uploads directory")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("seed/seed.json"),
        help="Generated EmDash seed path",
    )
    args = parser.parse_args()
    if not args.sql.is_file():
        parser.error(f"SQL export not found: {args.sql}")
    if not args.uploads.is_dir():
        parser.error(f"Uploads directory not found: {args.uploads}")

    uploads = args.uploads.resolve()
    posts: list[dict] = []
    metadata: dict[int, dict[str, str | None]] = {}
    attachment_urls: dict[int, str] = {}
    terms: dict[int, dict] = {}
    term_taxonomy: dict[int, dict] = {}
    relationships: dict[int, list[int]] = {}

    for statement in insert_statements(args.sql):
        table, columns, rows = parse_mysql_insert(statement)
        for values in rows:
            record = dict(zip(columns, values))
            if table == "wp_posts":
                if record.get("post_type") == "attachment":
                    attachment_id = int(record["ID"] or 0)
                    attachment_urls[attachment_id] = (
                        record.get("guid") or ""
                    )
                if (
                    record.get("post_status") == "publish"
                    and record.get("post_type") in POST_TYPE_COLLECTION
                    and record.get("post_name")
                    not in PLACEHOLDER_SLUGS[
                        POST_TYPE_COLLECTION[str(record.get("post_type"))]
                    ]
                ):
                    posts.append(record)
            elif table == "wp_postmeta":
                post_id = int(record.get("post_id") or 0)
                key = record.get("meta_key")
                if key in ("_thumbnail_id", "_wp_attached_file", "_wp_attachment_image_alt"):
                    metadata.setdefault(post_id, {})[key] = record.get("meta_value")
            elif table == "wp_terms":
                term_id = int(record.get("term_id") or 0)
                terms[term_id] = {
                    "slug": record.get("slug") or "",
                    "label": record.get("name") or "",
                }
            elif table == "wp_term_taxonomy":
                term_taxonomy[int(record.get("term_taxonomy_id") or 0)] = {
                    "term_id": int(record.get("term_id") or 0),
                    "taxonomy": record.get("taxonomy") or "",
                    "description": record.get("description") or "",
                }
            elif table == "wp_term_relationships":
                object_id = int(record.get("object_id") or 0)
                relationships.setdefault(object_id, []).append(
                    int(record.get("term_taxonomy_id") or 0)
                )

    taxonomies: dict[str, list[dict]] = {"category": [], "tag": []}
    term_slugs: dict[int, tuple[str, str]] = {}
    for taxonomy_id, taxonomy in term_taxonomy.items():
        taxonomy_name = taxonomy["taxonomy"]
        if taxonomy_name not in ("category", "post_tag"):
            continue
        term = terms.get(taxonomy["term_id"])
        if not term or not term["slug"]:
            continue
        name = "category" if taxonomy_name == "category" else "tag"
        term_slugs[taxonomy_id] = (name, term["slug"])
        taxonomies[name].append(
            {
                "slug": slugify(term["slug"], f"term-{taxonomy['term_id']}"),
                "label": term["label"],
                "description": taxonomy["description"],
            }
        )
    for name in taxonomies:
        taxonomies[name] = sorted(
            {item["slug"]: item for item in taxonomies[name]}.values(),
            key=lambda item: item["label"].casefold(),
        )

    content: dict[str, list[dict]] = {slug: [] for slug in COLLECTION_LABELS}
    redirects: list[dict] = []
    used_slugs: dict[str, set[str]] = {slug: set() for slug in content}
    matched_media = 0
    external_media = 0

    for post in sorted(posts, key=lambda row: (row.get("post_date") or "", int(row["ID"]))):
        wp_id = int(post["ID"])
        post_type = str(post["post_type"])
        collection = POST_TYPE_COLLECTION[post_type]
        title = html.unescape(post.get("post_title") or "").strip() or "Fără titlu"
        slug = slugify(post.get("post_name") or title, f"wp-{wp_id}")
        if slug in used_slugs[collection]:
            slug = f"{slug}-{wp_id}"
        used_slugs[collection].add(slug)

        source_date = post.get("post_date") or ""
        if source_date.startswith("0000-00-00"):
            source_date = ""
        elif " " in source_date:
            source_date = source_date.replace(" ", "T") + "Z"

        meta = metadata.get(wp_id, {})
        image_url = None
        thumbnail_id = meta.get("_thumbnail_id")
        if thumbnail_id and thumbnail_id.isdigit():
            image_id = int(thumbnail_id)
            image_url = attachment_urls.get(image_id)
            attachment_meta = metadata.get(image_id, {})
            file_path = attachment_meta.get("_wp_attached_file")
            if file_path:
                local_file = uploads.joinpath(*file_path.split("/"))
                if local_file.is_file():
                    image_url = SITE_ORIGIN + "/wp-content/uploads/" + file_path
            if image_url:
                rewritten = media_url(image_url, uploads)
                if rewritten and rewritten.startswith("/"):
                    matched_media += 1
                    image_url = rewritten
                else:
                    external_media += 1

        markup = post.get("post_content") or ""
        body = portable_text(markup, uploads)
        form = form_kind(markup) if collection == "pages" else ""
        date_path = ""
        if collection == "announcements" and len(source_date) >= 7:
            date_path = "/" + source_date[0:4] + "/" + source_date[5:7] + "/" + slug
            redirects.append(
                {
                    "source": date_path,
                    "destination": f"/noutati/{slug}",
                    "type": 308,
                    "enabled": True,
                    "groupName": "Migrare WordPress",
                }
            )

        data = {
            "title": title,
            "excerpt": html.unescape(post.get("post_excerpt") or "").strip(),
            "content": body,
            "featured_image_url": image_url or "",
            "source_url": SITE_ORIGIN + "/" + slug + "/",
            "source_id": str(wp_id),
            "source_date": source_date or None,
        }
        if collection == "pages":
            data["has_form"] = bool(form)
            data["form_kind"] = form or "contact"
        tax_assignments: dict[str, list[str]] = {}
        if collection == "announcements":
            for taxonomy_id in relationships.get(wp_id, []):
                taxonomy_term = term_slugs.get(taxonomy_id)
                if taxonomy_term:
                    name, term_slug = taxonomy_term
                    safe_term_slug = slugify(term_slug, "term")
                    tax_assignments.setdefault(name, []).append(safe_term_slug)

        entry = {
            "id": f"wp-{collection}-{wp_id}",
            "slug": slug,
            "status": "published",
            "data": data,
        }
        if tax_assignments:
            entry["taxonomies"] = tax_assignments
        content[collection].append(entry)

    seed = {
        "$schema": "https://emdashcms.com/seed.schema.json",
        "version": "1",
        "defaultLocale": "ro",
        "meta": {
            "name": "Liceul Teoretic „Onisifor Ghibu”",
            "description": "Site-ul oficial al Liceului Teoretic „Onisifor Ghibu” din Cluj-Napoca.",
            "author": "Liceul Teoretic „Onisifor Ghibu”",
        },
        "settings": {
            "title": "Liceul Teoretic „Onisifor Ghibu”",
            "tagline": "Educație, performanță și comunitate în Cluj-Napoca",
        },
        "collections": [
            collection_schema(slug) for slug in COLLECTION_LABELS
        ],
        "taxonomies": [
            {
                "name": "category",
                "label": "Categorii",
                "labelSingular": "Categorie",
                "hierarchical": True,
                "collections": ["announcements"],
                "terms": taxonomies["category"],
            },
            {
                "name": "tag",
                "label": "Etichete",
                "labelSingular": "Etichetă",
                "hierarchical": False,
                "collections": ["announcements"],
                "terms": taxonomies["tag"],
            },
        ],
        "menus": [
            {
                "name": "primary",
                "label": "Navigare principală",
                "items": [
                    {"type": "custom", "label": "Acasă", "url": "/"},
                    {"type": "custom", "label": "Despre liceu", "url": "/despre-noi"},
                    {"type": "custom", "label": "Anunțuri", "url": "/noutati"},
                    {"type": "custom", "label": "Profesori", "url": "/profesori"},
                    {"type": "custom", "label": "Elevi", "url": "/elevi"},
                    {"type": "custom", "label": "Proiecte", "url": "/proiecte"},
                    {"type": "custom", "label": "Contact", "url": "/contact"},
                ],
            }
        ],
        "content": content,
        "redirects": redirects,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(seed, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary = {slug: len(entries) for slug, entries in content.items()}
    print(json.dumps({
        "output": str(args.output),
        "collections": summary,
        "redirects": len(redirects),
        "available_featured_media": matched_media,
        "external_featured_media": external_media,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
