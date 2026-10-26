# Context

read @/.dev/general/prd.md to understand the project, and then go through the project, including all files and folder strucure. read @/.dev/general/research.md to understand the context, and then go through the project then look at tfiles and foldersto understand project stucture. @/.dev/general/error-handling.md is the file how to handle and display errors. Read @/.dev/memory-main.md to learn from past sessions.

## General rules:

1. when creating API routes, always go through our other API route's controller, service and route files to learn our current style of implementation.
2. When creating a new page in frontend, always make sure you follow the current design by learning from our other pages, we use shadcn for components. When designing your own components or pages, follow the shadcn style.
3. Always use the translation feature in frontend and backend and provide the English translation only.
4. When importing from a file, always read the file that is imported, don't assume anything when importing.
5. Our coding style is in @/.prettierrc , make sure you follow it.
6. Use logger exported from our logger module, rather than console.log for logging
7. Never directly write any database migration files, only use the root package's db:generate and db:migrate scripts for generating migration files.
8. When asked you to write commit message, be brief, no ai jargon, no line breaks midsentence.

# Task
