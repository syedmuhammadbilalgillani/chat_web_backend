import { Request, Response, NextFunction } from "express";

export const notFound = (_req: Request, res: Response, _next: NextFunction) => {
  res.status(404).json({ message: "Not Found" });
};

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ message: err.message || "Server Error" });
};
