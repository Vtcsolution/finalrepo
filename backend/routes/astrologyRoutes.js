const express = require("express");
const router = express.Router();
const { getAstrologyReport, generateAstrologyReport ,getAllAstrologyReports,getAstrologyReportById} = require("../controllers/astrologyController");
const { protect } = require("../middleware/auth");

router.get("/astrology-report", protect, getAstrologyReport);
router.post("/astrology-report", protect, generateAstrologyReport);
router.get("/reports", protect, getAllAstrologyReports);
router.get("/reports/:reportId", protect, getAstrologyReportById);

module.exports = router;