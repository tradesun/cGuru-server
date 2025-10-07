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

  // Country → Regions mapping used by profile edit form on dashboard
  const COUNTRY_REGIONS = {
    'Australia': ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT'],
    'New Zealand': [
      'Auckland',
      'Bay of Plenty',
      'Canterbury',
      'Gisborne',
      'Hawke’s Bay',
      'Manawatu-Wanganui',
      'Marlborough',
      'Nelson',
      'Northland',
      'Otago',
      'Southland',
      'Taranaki',
      'Tasman',
      'Waikato',
      'Wellington',
      'West Coast'
    ],
    'United States': [
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
      'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
      'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
    ],
    'United Kingdom': ['England', 'Scotland', 'Wales', 'Northern Ireland']
  };

  // World countries list (short, commonly used UN member set)
  const WORLD_COUNTRIES = [
    'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria','Azerbaijan',
    'Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi',
    'Cabo Verde','Cambodia','Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo (Congo-Brazzaville)','Costa Rica','Cote d’Ivoire','Croatia','Cuba','Cyprus','Czechia',
    'Democratic Republic of the Congo','Denmark','Djibouti','Dominica','Dominican Republic',
    'Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini (fmr. "Swaziland")','Ethiopia',
    'Fiji','Finland','France',
    'Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana',
    'Haiti','Honduras','Hungary',
    'Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy',
    'Jamaica','Japan','Jordan',
    'Kazakhstan','Kenya','Kiribati','Kuwait','Kyrgyzstan',
    'Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg',
    'Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar',
    'Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia','Norway',
    'Oman',
    'Pakistan','Palau','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal',
    'Qatar',
    'Romania','Russia','Rwanda',
    'Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria',
    'Tajikistan','Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu',
    'Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan',
    'Vanuatu','Vatican City','Venezuela','Vietnam',
    'Yemen',
    'Zambia','Zimbabwe'
  ];

  window.Constants = { ASSESSMENT_TITLES, ASSESSMENT_TAKE_URL, ASSESSMENT_TAKE_URLS, STAGES, COUNTRY_REGIONS, WORLD_COUNTRIES };
})();


