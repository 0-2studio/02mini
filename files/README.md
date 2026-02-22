# Files Directory

This directory contains all files created by 02 that are not:
- Memory files (stored in `memory/`)
- Skill files (stored in `skills/`)

## Purpose

Store user documents, generated content, output data, reports, and any other files created during conversations.

## Structure

```
files/
├── README.md           # This file
├── documents/          # User documents
├── output/            # Generated output
├── data/              # Data files
└── temp/              # Temporary files
```

## Usage

AI will automatically place files here when:
- Creating reports or documents
- Saving generated content
- Exporting data
- Creating any non-memory, non-skill files

## Examples

- `files/report.md` - A generated report
- `files/output/results.json` - Output data
- `files/documents/notes.txt` - User notes
