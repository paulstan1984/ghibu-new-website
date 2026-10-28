# Liceul Teoretic „Onisifor Ghibu”

Site de prezentare în limba română, construit cu Astro și EmDash. Rulează pe Node.js și folosește SQLite și stocare locală pentru mediile de dezvoltare și producție.

## Pagini

| Pagină | Rută |
|---|---|
| Pagina principală | `/` |
| Despre liceu | `/despre-noi` |
| Anunțuri | `/noutati` |
| Profesori | `/profesori` |
| Elevi | `/elevi` |
| Proiecte și activități | `/proiecte` |
| Documente | `/documente` |
| Admitere | `/admitere` |
| Contact | `/contact` |
| Căutare | `/cautare` |
| Pagini importate din WordPress | `/:slug` |

Rutele publice vechi ale blogului redirecționează către secțiunile echivalente ale site-ului.

## Dezvoltare locală

```bash
npm install
npm run dev
```

Site-ul rulează la `http://localhost:4321`, iar panoul EmDash la `http://localhost:4321/_emdash/admin`. Pentru a încărca modelul și conținutul în baza SQLite configurată, aplică seed-ul:

```powershell
npx emdash seed .\seed\seed.json --database .\data.db --uploads-dir .\uploads
```

Dacă `DATABASE_PATH` sau `MEDIA_DIRECTORY` au alte valori, folosește aceleași căi pentru opțiunile `--database` și `--uploads-dir`.

Configurația poate fi făcută în `.env` (vezi `.env.example`):

- `DATABASE_PATH` — fișierul SQLite; implicit `./data.db`.
- `MEDIA_DIRECTORY` — directorul media EmDash; implicit `./uploads`.
- `WORDPRESS_UPLOADS_DIR` — directorul arhivei WordPress folosit de ruta `/wp-content/uploads/...`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SCHOOL_MAIL_FROM` — configurarea livrării formularelor.
- `SCHOOL_CONTACT_RECIPIENT` — destinatar opțional; implicit `office@liceul-onisifor-ghibu.ro`.

Arhiva media curentă poate fi folosită local cu `WORDPRESS_UPLOADS_DIR=..\uploads`. Fișierele absente sunt redirecționate către site-ul WordPress original.

## Importul conținutului WordPress

```powershell
python .\scripts\migrate-wordpress.py `
  --sql C:\work\www\onisifor-ghibu\liceulon_db.sql `
  --uploads C:\work\www\onisifor-ghibu\uploads `
  --output .\seed\seed.json
```

Importul păstrează paginile și anunțurile publicate relevante, dar exclude intrări demonstrative și conținut placeholder al temei WordPress. Definițiile originale ale formularelor și trimiterile anterioare nu sunt incluse în export și nu sunt importate.

## Producție și verificare

Configurează `DATABASE_PATH` și directoarele de stocare în timpul build-ului de producție și la runtime, către volume persistente cu permisiuni de scriere pentru procesul Node.js. `WORDPRESS_UPLOADS_DIR` este citit de ruta media la runtime. Backup-ul trebuie să includă baza SQLite, fișierele media EmDash și arhiva WordPress folosită de ruta media. Testează restaurarea backup-ului înainte de lansare.

Înainte de lansare:

```bash
npm run typecheck
npm run build
```

Configurează și testează SMTP înainte de a activa formularul; până atunci endpointul afișează o eroare explicită, fără să confirme în mod fals trimiterea mesajelor.
