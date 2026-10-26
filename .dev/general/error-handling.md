### **1. Introduction & Core Principles**

This document establishes the mandatory principles for error handling and messaging across the entire application stack. A unified strategy is critical for creating a predictable, maintainable, and user-friendly system. As a coding agent, you must adhere to these rules to ensure consistency.

**Core Principles:**

- **Predictability:** The frontend must always know the exact structure of an error response from the backend.
- **Centralization:** Error handling logic must be centralized in both the backend and frontend to avoid code duplication and simplify maintenance.
- **User-Centricity:** Error messages displayed to the user must be clear, concise, and helpful, without exposing sensitive system internals.
- **Developer-Clarity:** Logged errors must be detailed and structured to enable rapid debugging.

### **2. Backend (Express API) Error Handling**

### **2.1. Standardized Error Response Format**

All errors sent from the API to the client **must** conform to the following JSON structure:

```json
{
	"status": "error",
	"statusCode": 404,
	"message": "The requested resource could not be found.",
	"errors": null
}
```

Or for validation errors:

```json
{
	"status": "error",
	"statusCode": 422,
	"message": "Invalid input provided.",
	"errors": [
		{
			"field": "email",
			"message": "Email must be a valid email address."
		},
		{
			"field": "password",
			"message": "Password must be at least 8 characters long."
		}
	]
}
```

- `status`: Always `"error"`.
- `statusCode`: The HTTP status code (e.g., `400`, `404`, `500`).
- `message`: A high-level, user-friendly error message.
- `errors`: `null` or an array of objects for detailed validation errors.

### **2.2. Centralized Error Handler Middleware**

You **must** implement a single, application-wide Express error-handling middleware. This middleware will be the last `app.use()` call in your `server.ts` file.

- **Responsibility:** It catches all errors passed via `next(error)`.
- **Function:** It formats the caught error into the standard JSON response format and sends it to the client.
- **Logging:** It is responsible for logging the error (see Section 4).

**Example Implementation (`/backend/src/api/middleware/errorHandler.ts`):**

```ts
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError';
import { logger } from '../../config/logger'; // Assuming a logger service

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
	let statusCode = 500;
	let message = 'An unexpected error occurred on the server.';
	let errors = null;

	if (err instanceof ApiError) {
		statusCode = err.statusCode;
		message = err.message;
		// 'errors' could be a property on a more specific ValidationError class
		errors = (err as any).errors || null;
	}

	// Logging
	if (statusCode >= 500) {
		logger.error({
			message: err.message,
			statusCode,
			stack: err.stack,
			path: req.path,
			method: req.method,
		});
	} else {
		logger.warn({
			message: err.message,
			statusCode,
			path: req.path,
		});
	}

	res.status(statusCode).json({
		status: 'error',
		statusCode,
		message,
		errors,
	});
};
```

### **2.3. Custom Error Classes**

To ensure errors carry the necessary metadata (like a status code), you **must** use custom error classes that extend the native `Error` class.

**Example (`/backend/src/api/errors/ApiError.ts`):**

```ts
export class ApiError extends Error {
	public readonly statusCode: number;

	constructor(statusCode: number, message: string) {
		super(message);
		this.statusCode = statusCode;
		// Maintains proper stack trace for where our error was thrown
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export class NotFoundError extends ApiError {
	constructor(message = 'The requested resource could not be found.') {
		super(404, message);
	}
}

export class ValidationError extends ApiError {
	public readonly errors: { field: string; message: string }[];

	constructor(errors: { field: string; message: string }[], message = 'Invalid input provided.') {
		super(422, message);
		this.errors = errors;
	}
}
```

Route handlers and services should `throw new NotFoundError('User not found')` instead of a generic `Error`. The central handler will then use the `.statusCode` property.

### **2.4. Handling Asynchronous Errors**

All `async` route handlers **must** be wrapped in a utility that catches promise rejections and passes them to `next()`. This ensures that errors in asynchronous code are correctly routed to the central error handler.

**Example Utility (`/backend/src/api/utils/catchAsync.ts`):**

```ts
import { Request, Response, NextFunction } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

export const catchAsync = (fn: AsyncRequestHandler) => {
	return (req: Request, res: Response, next: NextFunction) => {
		fn(req, res, next).catch(next);
	};
};

// Usage in a route definition:
// router.get('/users/:id', catchAsync(userController.getUserById));
```

### **3. Frontend (SvelteKit) Error Handling**

### **3.1. Centralized API Client (`/lib/utils/api.ts`)**

The `fetch` wrapper utility is the single point of contact with the backend API and therefore the single point for handling API errors.

- It must inspect the HTTP response status. If `response.ok` is `false`, it must parse the JSON error body.
- It should then throw a custom client-side error object that contains the `statusCode`, `message`, and `errors` array from the API response.

**Example Implementation (`/frontend/src/lib/utils/api.ts`):**

```ts

// Custom client-side error class
export class ClientApiError extends Error {
	public readonly statusCode: number;
	public readonly validationErrors: ValidationError[] | null;

	constructor(apiError: ApiErrorResponse) {
		super(apiError.message);
		this.name = 'ClientApiError';
		this.statusCode = apiError.statusCode;
		this.validationErrors = apiError.errors;
	}
}

// Central fetch wrapper
export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
	// Add auth headers, etc. here
	const response = await fetch(url, options);

	if (!response.ok) {
		const errorData: ApiErrorResponse = await response.json();
		throw new ClientApiError(errorData);
	}

	return response.json() as Promise<T>;
}
```

### **3.2. Displaying Errors to the User**

- **Form Validation:** For `422 Unprocessable Entity` errors, the calling component must catch the error and use the `errors` array to display specific messages next to the corresponding form fields.
- **General Errors:** For all other errors (e.g., `401`, `403`, `500`), use a non-intrusive "toast" or notification component to display the user-friendly `message` from the API response.
- **Prohibition:** You **must not** use the browser's `alert()` function.

### **3.3. Application-Level Errors**

Use SvelteKit's built-in error handling for page-level errors:

- Use the `error` helper from `@sveltejs/kit` in `load` functions to render the nearest `+error.svelte` page for situations like 404s.

### **4. Logging Principles**

- **Location:** Logging is a server-side concern. All logging must happen within the centralized Express error handler.
- **Structured Logging:** Use a structured logger like **Pino** or **Winston**. Logs must be in JSON format for easy parsing by log management systems.
- **Log Levels:**
    - **`error`:** For unexpected 5xx server errors. These logs **must** include the full stack trace.
    - **`warn`:** For handled/expected 4xx client errors (e.g., `NotFoundError`, `ValidationError`). Stack traces are not necessary.
- **No Sensitive Data:** You **must** ensure that logs never contain sensitive user data, including passwords, session tokens, or API keys. Sanitize log output where necessary.
