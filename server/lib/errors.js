export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new AppError(400, message);
export const unauthorized = (message = "請先登入") => new AppError(401, message);
export const forbidden = (message = "沒有權限") => new AppError(403, message);
export const notFound = (message = "找不到資料") => new AppError(404, message);
export const conflict = (message) => new AppError(409, message);
