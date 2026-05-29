export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = "APP_ERROR"
  ) {
    super(message);
  }
}
