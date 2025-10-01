(function() {
  // Assessment ID (as string) to display name mapping
  // Keep order consistent with backend assessment IDs (1..10)
  const ASSESSMENT_TITLES = {
    '1': 'Business Strategy & Identity',
    '2': 'Go‑to‑Market & Demand',
    '3': 'Finance & Commercials',
    '4': 'People & Org Design',
    '5': 'Solution Productisation',
    '6': 'Client Experience & Success',
    '7': 'Advisory, Risk & Compliance',
    '8': 'Project & Change Services',
    '9': 'Scalable Centralised Services',
    '10': 'End‑User Enablement & Support'
  };

  // Optional: base URL for taking assessments; replace with real URL if available
  const ASSESSMENT_TAKE_URL = '';

  // Direct URLs for each assessment ID
  const ASSESSMENT_TAKE_URLS = {
    '1': 'https://channelguru-business-strategy-planning-assessment.scoreapp.com/',
    '2': 'https://channelguru-oganisational-design-people-hr-assessment.scoreapp.com/',
    '3': 'https://channelguru-finance-commercials-administration-assessment.scoreapp.com/',
    '4': 'https://channelgurusolution-productisation.scoreapp.com/',
    '5': 'https://channel-guru-go-to-market-demandgeneration-assessment.scoreapp.com/',
    '6': 'https://channelguru-client-experience-success.scoreapp.com/',
    '7': 'https://channelguru-advisory-governance-risk-compliance-assessment.scoreapp.com/',
    '8': 'https://channelguruproject-change-services-assessment.scoreapp.com/',
    '9': 'https://channelguru-scalable-centralised-services.scoreapp.com/',
    '10': 'https://brad-eaqht1yp.scoreapp.com/'
  };

  // Maturity stages configuration (shared across pages)
  const STAGES = [
    { range: '0–10%',  min: 0,  max: 10,  stage: 0, name: 'Awareness' },
    { range: '11–30%', min: 11, max: 30, stage: 1, name: 'Foundational' },
    { range: '11–50%', min: 11, max: 50, stage: 2, name: 'Developing' },
    { range: '51–70%', min: 51, max: 70, stage: 3, name: 'Scaling' },
    { range: '71–90%', min: 71, max: 90, stage: 4, name: 'Optimizing' },
    { range: '91–100%',min: 91, max: 100,stage: 5, name: 'Leading' }
  ];

  window.Constants = { ASSESSMENT_TITLES, ASSESSMENT_TAKE_URL, ASSESSMENT_TAKE_URLS, STAGES };
})();


