# Liceul Teoretic „Onisifor Ghibu” site migration plan

## Confirmed requirements

- Rebuild the public website in EmDash as a high-school presentation site.
- Romanian only.
- Recreate all current public forms; do not migrate historical submissions.
- Use SQLite in development and production.
- Available media is in `C:\work\www\onisifor-ghibu\uploads\`. It covers recent years only.

## Current-site and source inventory

- The live homepage has a school-photo hero, prominent notices and admissions information, contact details and office hours, school history, feature sections, a gallery, and a profile of Onisifor Ghibu.
- Main navigation includes Acasă, Anunțuri, Documente, Profesori, Elevi, Proiecte, Biblio FM, Secția maghiară, Arhivă, and Contact.
- The WordPress SQL export contains 51 published pages, 23 published posts, 6 courses, 6 events, and 8 teacher profiles. It also contains WordPress/plugin records that are not site content and should not be migrated indiscriminately.
- The uploads folder contains 3,784 files (~639 MB) from 2023–2026. Some older media referenced by the site may be unavailable.
- The SQL references Contact Form 7 and theme-specific forms, but does not include form definitions. Public forms will be recreated; their non-public settings must be confirmed.
- The current project is a generic EmDash blog using Astro, SQLite, and local-file storage. Its seed and blog routes need to be adapted for the school site.

## Implementation plan

1. **Complete the route and content inventory**
   - Inspect the live navigation destinations and page templates.
   - Map WordPress pages, posts, taxonomies, course/event/teacher content, and media references to destination routes.
   - Preserve existing slugs where practical and prepare redirects for changed URLs.

2. **Design the EmDash content model**
   - Create collections for pages, announcements/news, teachers, courses, and events.
   - Define taxonomies and menus for the Romanian site structure.
   - Make homepage sections editable, including notices, admissions information, school history, key facts, and galleries.

3. **Migrate published content and available assets**
   - Convert published content and relevant metadata to EmDash seed/import data.
   - Preserve slugs and publication dates where practical.
   - Convert rich text and page-builder content into Portable Text or structured blocks.
   - Match media records to files in the uploads folder; identify missing or broken references instead of silently substituting assets.

4. **Recreate public forms**
   - Inventory every form visible on the public site, including fields, required validation, confirmation behavior, and error states.
   - Implement and test each form in the new site.
   - Do not migrate historical submissions.
   - Confirm notification recipients and any non-public email-delivery or spam-protection settings before launch.

5. **Build the presentation site**
   - Replace the blog homepage and navigation with the school identity and presentation design.
   - Implement the homepage, announcements and document archives, teacher/course/event pages, contact and school-section pages, and any required detail pages.
   - Ensure responsive layouts, accessible navigation, and usable document downloads.

6. **Configure SQLite production and verify**
   - Keep SQLite for both development and production.
   - Ensure the production host provides persistent writable storage for the database and uploaded media, and define backup/restore procedures.
   - Verify migrated-content counts, forms, images and downloads, links and redirects, mobile layouts, accessibility, and SEO metadata.

## Implementation status

- Implemented Romanian school navigation, presentation homepage, about, admissions, student resources, contact, privacy, announcements, documents, projects, and search pages.
- Added detail routes for announcements, teachers, programs, events, and imported WordPress pages, with redirects from the former blog routes.
- Added a repeatable SQL-to-EmDash seed generator. It skips identifiable theme-demo pages, placeholder announcements, and sample teachers/programs/events rather than presenting them as school information.
- The generated seed contains 28 school pages and 15 announcements; the six programs, six events, and eight teacher entries in the export were identifiable theme placeholders and are excluded.
- Added a local WordPress media route with path/symlink containment checks and a legacy-host fallback for files absent from the partial archive.
- Recreated contact and information-request forms. Historical form submissions are not migrated.
- Configured SQLite and local storage through environment variables for both development and production.

## Outstanding dependencies

- Confirm final form fields and any school-specific notification or confirmation requirements. The SQL export did not include the original form definitions.
- Configure and verify SMTP delivery in the target environment before accepting form submissions.
- Supply older media that must be retained but is absent from the available uploads folder, or approve omitting unavailable assets.
- Confirm production hosting supports persistent local storage for SQLite and media, and establish backups.
- Run the site against the migrated seed, verify content/media/routes/forms, and complete production deployment testing.

## Completion criteria

- Required public routes and navigation work in Romanian, with redirects for changed legacy URLs.
- Selected published content and available media are migrated and checked against the source inventory.
- Every current public form is recreated and tested; historical submissions remain unmigrated.
- Production SQLite and media storage persist across deployments and have a documented backup/restore process.
