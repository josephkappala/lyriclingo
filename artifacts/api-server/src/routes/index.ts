import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lyricsRouter from "./lyrics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(lyricsRouter);

export default router;
