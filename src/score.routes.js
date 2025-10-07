// score.routes.js
// Defines shared routes for webhooks and future REST endpoints.
const express = require('express');
const { ingest } = require('./controllers/webhook.controller');
const { getTotalScores, submissionDetails, addAction, getRecommendations, getAllRecommendations, getRecommendationsForDetailsPage, reorderAction, removeAction, systemRecommendations, updateProfile, sendAssignmentEmail, postponeAction, setOwnerAcknowledged, setActionNotesApi, setActionStatusApi, setActionOwnersRaw, setActionInvitesApi, benchmarkUserTotals, benchmarkCountries, benchmarkUserTotalsAverage, benchmarkAssessmentAverages, benchmarkMEFAverage, benchmarkUserTotalsAveragePerAssessment, requestResourcesEmail } = require('./controllers/api.controller');

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

// GET /api/v1/systemRecommendations?email=
router.get('/api/v1/systemRecommendations', systemRecommendations);

// POST /api/v1/updateProfile
router.post('/api/v1/updateProfile', updateProfile);

// POST /api/v1/sendAssignmentEmail
router.post('/api/v1/sendAssignmentEmail', sendAssignmentEmail);
router.post('/api/v1/requestResources', requestResourcesEmail);

// PUT /api/v1/postponeAction?action_id=
router.put('/api/v1/postponeAction', postponeAction);

// PUT /api/v1/setOwnerAcknowledged?action_id=
router.put('/api/v1/setOwnerAcknowledged', setOwnerAcknowledged);

// PUT /api/v1/setActionNotes?action_id=
router.put('/api/v1/setActionNotes', setActionNotesApi);

// PUT /api/v1/setActionStatus?action_id=
router.put('/api/v1/setActionStatus', setActionStatusApi);
router.put('/api/v1/setActionOwnersRaw', setActionOwnersRaw);
router.put('/api/v1/setActionInvites', setActionInvitesApi);

// Benchmarking API
router.get('/api/v1/benchmark/user_totals', benchmarkUserTotals);
router.get('/api/v1/benchmark/countries', benchmarkCountries);
router.get('/api/v1/benchmark/user_totals_avg', benchmarkUserTotalsAverage);
router.get('/api/v1/benchmark/assessment_avgs', benchmarkAssessmentAverages);
router.get('/api/v1/benchmark/user_totals_avg_per_assessment', benchmarkUserTotalsAveragePerAssessment);

module.exports = router;


