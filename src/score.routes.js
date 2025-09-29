// score.routes.js
// Defines shared routes for webhooks and future REST endpoints.
const express = require('express');
const { ingest } = require('./controllers/webhook.controller');
const { getTotalScores, submissionDetails, addAction, getRecommendations, getAllRecommendations, getRecommendationsForDetailsPage, reorderAction, removeAction } = require('./controllers/api.controller');

const router = express.Router();

// POST /addScore: webhook endpoint (rawBody handled in app.js)
router.post('/addScore', ingest);

// GET /api/v1/getTotalScores?email=
router.get('/api/v1/getTotalScores', getTotalScores);

// GET /api/v1/submissionDetails?result_key=
router.get('/api/v1/submissionDetails', submissionDetails);

// POST /api/v1/add_action
router.post('/api/v1/add_action', addAction);

// POST /api/v1/get_recommendations
router.post('/api/v1/get_recommendations', getRecommendations);

// GET /api/v1/get_recommendations_for_all_added_actions?email=
router.get('/api/v1/get_recommendations_for_all_added_actions', getAllRecommendations);

// POST /api/v1/get_recommendations_for_details_page
router.post('/api/v1/get_recommendations_for_details_page', getRecommendationsForDetailsPage);

// POST /api/v1/reorderAction?email=
router.post('/api/v1/reorderAction', reorderAction);

// PUT /api/v1/removeAction?action_id=
router.put('/api/v1/removeAction', removeAction);

module.exports = router;


