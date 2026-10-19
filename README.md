# Aurennis Learn

Aurennis Learn is a small study companion for working with text-based course PDFs. It extracts the document text in your browser and provides a study guide, flashcards, quizzes, and assessments.

## Run locally

You need Node.js and npm installed.

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Press `Ctrl+C` in the terminal to stop the local server.

## Check before sharing

```powershell
npm test
npm run lint
npm run build
```

## Publish with GitHub and Netlify

1. Create an empty repository on GitHub. Do not initialize it with a README, license, or `.gitignore`.
2. In a terminal opened at this project folder, run:

   ```powershell
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/aurennis-learn.git
   git push -u origin main
   ```

   Replace `YOUR-USERNAME` with your GitHub username.
3. In Netlify, import the GitHub repository. Netlify detects Next.js and configures the build for the app.
4. Each later `git push` can trigger a new Netlify deploy.

## Notes

- Text-based PDFs are supported; image-only scans need OCR and are not processed.
- Study materials use local text extraction and deterministic, source-derived rules. They are not reviewed by a subject expert, so verify important details against the original document.
- The PDF text stays in the browser until the study request is sent to this app's server route. The app does not require a third-party model key.
- Session progress and theme are stored in this browser. The PDF text itself is not saved in browser storage.
- The project has no account system or cloud-synced progress.
