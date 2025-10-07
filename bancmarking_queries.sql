
#show total score for each user

WITH latest_per_assessment AS (
  SELECT
    s.email,
    s.assessment_id,
    s.total_percent,
    ROW_NUMBER() OVER (
      PARTITION BY s.email, s.assessment_id
      ORDER BY s.finished_at DESC, s.id DESC
    ) AS rn
  FROM submissions s
)
SELECT
  l.email,
  ROUND(AVG(l.total_percent))      AS total_score_percent,
  COUNT(*)                         AS assessments_count,
  MAX(p.size)                      AS size,
  MAX(p.country)                   AS country,
  MAX(p.region)                    AS region,
  MAX(p.location)                  AS location
FROM latest_per_assessment l
LEFT JOIN profile p
  ON p.email = l.email
WHERE l.rn = 1
GROUP BY l.email
ORDER BY l.email;