# Aurennis Learn

Aurennis Learn is a browser-based study companion for text-based course PDFs. It extracts the document text and turns it into a study guide, flashcards, practice quizzes, and configurable assessments.

## Features

- Upload a PDF by file picker or drag and drop.
- Extract and preview readable PDF text in the browser.
- Review a structured guide with key topics and revision priorities.
- Study interactive flashcards and mark topics for revision.
- Practise with quick quizzes and configurable assessments.
- Review assessment scores, answers, and topics to revisit.
- Choose a light or dark theme and keep session progress in the browser.

## Technology

- Next.js App Router and React
- TypeScript
- Tailwind CSS
- PDF.js for PDF text extraction
- Zod for request and content validation
- Vitest for utility tests

## Run locally

Install [Node.js](https://nodejs.org/) first. In a terminal opened at the project folder, run:

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Stop the local development server with `Ctrl+C` in its terminal.

## Quality checks

```powershell
npm test
npm run lint
npm run build
```

## Deployment

The application can be deployed to Netlify by importing its GitHub repository. Netlify supports the Next.js App Router and detects the required build configuration.

## Limitations and data handling

- Image-only or scanned PDFs are not supported; the document must contain extractable text.
- Study materials are built with local, rule-based logic and are not reviewed by a subject expert. Check important details against the original PDF.
- The PDF is not stored in browser storage. Extracted text is sent to this application's study endpoint to create the requested study materials.
- Theme and session progress are stored in the current browser. There are no user accounts or cloud-synced study records.
