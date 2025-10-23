import express, { Request, Response } from 'express';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  

  

  try {
  console.log("=======")
  } catch {
    return res.status(400).json({
      success: false,
      message: 'Invalid URL format',
      error: 'INVALID_URL',
    });
  }

 
});


export default router;
