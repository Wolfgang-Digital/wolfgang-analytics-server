const COLUMNS = [
  'company_name',
  'date_added',
  'project_name',
  'is_new',
  'status',
  'country',
  'channels',
  'source',
  'outcome',
  'source_comment',
  'last_updated',
  'details',
  'success_probability',
  'loss_reason',
  'contact_email',
  'channel_data',
  'date_closed',
  'proposal_doc_link',
  'analytics_12mv',
  'cro_12mv',
  'content_12mv',
  'creative_12mv',
  'email_12mv',
  'ppc_12mv',
  'seo_12mv',
  'social_12mv',
  'actual_12mv',
  'pre_qual_score'
];

const CHANNEL_DATA_KEYS = ['name', 'duration', 'outcome'];

const QUERY_KEYS = ['q', 'leads'];

const CHANNELS = ['Analytics', 'CRO', 'Content', 'Creative', 'Email', 'PPC', 'SEO', 'Social'];

const generateOutcomeString = status => `
  (outcome = 'Won' OR 
  channel_data->'Analytics'->>'outcome' = '${status}' OR 
  channel_data->'CRO'->>'outcome' = '${status}' OR 
  channel_data->'Content'->>'outcome' = '${status}' OR 
  channel_data->'Creative'->>'outcome' = '${status}' OR 
  channel_data->'Email'->>'outcome' = '${status}' OR 
  channel_data->'PPC'->>'outcome' = '${status}' OR 
  channel_data->'SEO'->>'outcome' = '${status}' OR 
  channel_data->'Social'->>'outcome' = '${status}') 
`;

const generateDurationString = duration => `
  (channel_data->'Analytics'->>'duration' = '${duration}' OR 
  channel_data->'CRO'->>'duration' = '${duration}' OR 
  channel_data->'Content'->>'duration' = '${duration}' OR 
  channel_data->'Creative'->>'duration' = '${duration}' OR 
  channel_data->'Email'->>'duration' = '${duration}' OR 
  channel_data->'PPC'->>'duration' = '${duration}' OR 
  channel_data->'SEO'->>'duration' = '${duration}' OR 
  channel_data->'Social'->>'duration' = '${duration}') 
`;

// Generates 'num' amount of SQL variables, e.g: '$1, $2, $3'
const generateValueString = num => new Array(num).fill(0).map((x, i) => `$${i + 1}`).join(', ');

// Generates SQL to sum all 12 month values
const generateTotalString = () => {
  return COLUMNS.filter(field => field.match(/_12mv/)).map(field => `COALESCE(${field}, 0)`).join(' + ');
};

// Generates SQL to sum all 12 month values for won channels
const generateSumTotalString = outcome => {
  const totals = COLUMNS.filter(field => field !== 'actual_12mv' && field.match(/_12mv/)).map(field => {
    const channel = CHANNELS.find(channel => channel.toLowerCase() === field.replace('_12mv', ''));
    const fieldString = outcome ? `COALESCE(SUM(${field})` : `COALESCE(SUM(${field}), 0)`
    return `${fieldString}${outcome ? ` FILTER(WHERE channel_data->'${channel}'->>'outcome' = '${outcome}'), 0)` : ''}`;
  }).join(' + ');
  return totals;
};

const wonRevenueString = `
COALESCE(SUM((NULLIF(channel_data->'Analytics'->>'won_revenue', ''))::numeric) FILTER(WHERE channel_data->'Analytics'->>'outcome' = 'Won'), 0) + 
COALESCE(SUM((NULLIF(channel_data->'CRO'->>'won_revenue', ''))::numeric) FILTER(WHERE channel_data->'CRO'->>'outcome' = 'Won'), 0) + 
COALESCE(SUM((NULLIF(channel_data->'Content'->>'won_revenue', ''))::numeric) FILTER(WHERE channel_data->'Content'->>'outcome' = 'Won'), 0) + 
COALESCE(SUM((NULLIF(channel_data->'Creative'->>'won_revenue', ''))::numeric) FILTER(WHERE channel_data->'Creative'->>'outcome' = 'Won'), 0) + 
COALESCE(SUM((NULLIF(channel_data->'Email'->>'won_revenue', ''))::numeric) FILTER(WHERE channel_data->'Email'->>'outcome' = 'Won'), 0) + 
COALESCE(SUM((NULLIF(channel_data->'PPC'->>'won_revenue', ''))::numeric) FILTER(WHERE channel_data->'PPC'->>'outcome' = 'Won'), 0) + 
COALESCE(SUM((NULLIF(channel_data->'SEO'->>'won_revenue', ''))::numeric) FILTER(WHERE channel_data->'SEO'->>'outcome' = 'Won'), 0) + 
COALESCE(SUM((NULLIF(channel_data->'Social'->>'won_revenue', ''))::numeric) FILTER(WHERE channel_data->'Social'->>'outcome' = 'Won'), 0)
`;

const generateWhereClause = query => {
  const clauses = [];
  let values = [];

  Object.entries(query).forEach(([column, value]) => {
    switch (column) {
      case 'date_added':
        values = values.concat(value.split('AND'));
        clauses.push(`date_added BETWEEN $${values.length - 1} AND $${values.length}`);
        break;

      case 'date_closed':
        values = values.concat(value.split('AND'));
        clauses.push(`date_closed BETWEEN $${values.length - 1} AND $${values.length}`);
        break;

      case 'outcome':
        clauses.push(generateOutcomeString(value));
        break;

      case 'duration':
        clauses.push(generateDurationString(value));
        break;

      case 'status':
        values.push(value);
        clauses.push(`status = $${values.length}`);
        break;

      default:
        break;
    }
  });
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereClause, values };
};

const generateSelectAllQuery = (query, setLimit = true) => {
  const clauses = [];
  let values = [];

  Object.entries(query).forEach(([column, value]) => {
    if (QUERY_KEYS.includes(column) || COLUMNS.includes(column) || CHANNEL_DATA_KEYS.includes(column)) {
      switch (column) {
        // Query by company name, channel, project name or country
        case 'q':
          values.push(value);
          clauses.push(`(
            company_name ILIKE '%' || $${values.length} || '%' OR 
            LOWER(channels::text)::text[] @> ARRAY[$${values.length}] OR 
            project_name ILIKE '%' || $${values.length} || '%' OR 
            country ILIKE '%' || $${values.length} || '%'
          )`);
          break;

        case 'date_added':
          values = values.concat(value.split('AND'));
          clauses.push(`date_added BETWEEN $${values.length - 1} AND $${values.length}`);
          break;

        case 'date_closed':
          values = values.concat(value.split('AND'));
          clauses.push(`date_closed BETWEEN $${values.length - 1} AND $${values.length}`);
          break;

        case 'is_new':
          values.push(value);
          clauses.push(`is_new = $${values.length}`);
          break;

        case 'channels':
          const channels = value.split(',').map(c => `"${c.trim()}"`).join(',');
          clauses.push(`channels && '{${channels}}'`);
          break;

        case 'leads':
          const leads = value.split(',').map((userId, i) => {
            if (i > 0) return `OR proposal_leads::jsonb @> '[{"user_id":"${userId}"}]'`;
            return `proposal_leads::jsonb @> '[{"user_id":"${userId}"}]'`;
          }).join(' ');
          clauses.push(leads);
          break;

        case 'duration':
          clauses.push(`value @> '{"duration":"${value}"}'`);
          break;

        case 'outcome':
          values.push(value);
          clauses.push(`(outcome = $${values.length} OR value @> '{"outcome":"${value}"}')`);
          break;

        case 'country':
          values.push(value.replace('!', ''));
          clauses.push(`country ${value.includes('!') ? 'NOT' : ''} ILIKE '%' || $${values.length} || '%'`);
          break;

        default:
          values.push(value);
          clauses.push(`${column} ILIKE '%' || $${values.length} || '%'`);
          break;
      }
    }
  });

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  if (setLimit) {
    const { offset = 0, limit = 20 } = query;
    values = values.concat([offset, limit]);
  }

  const text = `
    WITH leads AS (
      SELECT 
        enquiry_id,
        JSON_AGG(ROW_TO_JSON(users)) proposal_leads 
      FROM proposal_leads 
      JOIN users ON users.user_id = proposal_leads.user_id 
      GROUP BY enquiry_id
    )
    SELECT 
      id, 
      ${COLUMNS.join(', ')}, 
      ${generateTotalString()} as total_12mv, 
      proposal_leads::jsonb,  
      COUNT(*) OVER() AS total 
    FROM pipeline  
    FULL OUTER JOIN leads ON leads.enquiry_id = id 
    CROSS JOIN LATERAL jsonb_each(channel_data) channels 
    ${whereClause}  
    GROUP BY id, proposal_leads::jsonb  
    ORDER BY ${setLimit ? 'last_updated DESC' : 'company_name'} 
    ${setLimit ? `OFFSET $${values.length - 1} LIMIT $${values.length}` : ''}
  `;

  return { text, values };
};

const generateSelectOneQuery = id => {
  const text = `
    WITH leads AS (
      SELECT 
        enquiry_id,
        JSON_AGG(ROW_TO_JSON(users)) proposal_leads 
      FROM proposal_leads 
      JOIN users ON users.user_id = proposal_leads.user_id 
      GROUP BY enquiry_id
    )
    SELECT
      pipeline.*,
      proposal_leads 
    FROM pipeline  
    FULL OUTER JOIN leads ON leads.enquiry_id = id 
    WHERE id = $1
  `;

  return { text, values: [id] };
};

const generateCreateQuery = data => {
  const leads = data.proposal_leads.map(lead => `((SELECT id FROM enquiry), '${lead.value}')`).join(', ');

  const text = `
    WITH enquiry AS (
      INSERT INTO pipeline(
        company_name, date_added, project_name, is_new, country, channels, status, source, source_comment, 
        last_updated, details, success_probability, loss_reason, contact_email, channel_data, proposal_doc_link, 
        analytics_12mv, cro_12mv, content_12mv, creative_12mv, email_12mv, ppc_12mv, seo_12mv, social_12mv, 
        pre_qual_score
      ) 
      VALUES (${generateValueString(25)}) 
      RETURNING id
    ) 
    INSERT INTO proposal_leads(enquiry_id, user_id) 
    VALUES ${leads} 
  `;

  // new Date() is last_updated
  // 'Open' is status
  const values = [
    data.company_name, data.date_added, data.project_name, data.is_new, data.country, data.channels, 'Open', data.source, data.source_comment,
    new Date(), data.details, data.success_probability, data.loss_reason, data.contact_email, data.channel_data, data.proposal_doc_link,
    data.analytics_12mv, data.cro_12mv, data.content_12mv, data.creative_12mv, data.email_12mv, data.ppc_12mv, data.seo_12mv, data.social_12mv, 
    data.pre_qual_score
  ];

  return { text, values };
};

const generateUpdateQuery = (id, data) => {
  const clauses = [];
  const values = [id];

  Object.entries(data).forEach(([column, value]) => {
    if (COLUMNS.includes(column)) {
      switch (column) {
        // Ignore here as we handle in transaction
        case 'proposal_leads':
          break;

        // If channels are removed we should also remove the 12mv for those channels
        case 'channels':
          values.push(value);
          clauses.push(`channels = $${values.length}`);
          CHANNELS.forEach(channel => {
            if (!value.includes(channel)) {
              clauses.push(`${channel.toLowerCase()}_12mv = null`);
            }
          });
          break;

        default:
          values.push(value);
          clauses.push(`${column} = $${values.length}`);
          break;
      }
    }
  });

  //If leads are changed we remove all leads and add back the new ones - is false if no changes
  const deleteOldLeadsText = !!data.proposal_leads && 'DELETE FROM proposal_leads WHERE enquiry_id = $1';
  const deleteLeadsValues = [id];
  const insertNewLeadsText = (!!data.proposal_leads && data.proposal_leads.length > 0) &&
    `INSERT INTO proposal_leads(enquiry_id, user_id) 
    VALUES ${data.proposal_leads.map(leadId => `(${id}, '${leadId}')`).join(', ')}`;

  const updateText = `
    UPDATE pipeline 
    SET ${clauses.join(', ')}, 
    last_updated = CURRENT_DATE 
    WHERE id = $1
  `;

  const resultText = `
    WITH leads AS (
      SELECT 
        enquiry_id,
        JSON_AGG(ROW_TO_JSON(users)) proposal_leads 
      FROM proposal_leads 
      JOIN users ON users.user_id = proposal_leads.user_id 
      GROUP BY enquiry_id
    )
    SELECT
      pipeline.*,
      proposal_leads 
    FROM pipeline  
    FULL OUTER JOIN leads ON leads.enquiry_id = id 
    WHERE id = $1
  `;

  return { updateText, updateValues: values, deleteOldLeadsText, deleteLeadsValues, insertNewLeadsText, resultText, resultsValues: [id] };
};

const generateOverviewQuery = (query, type, isComparison) => {
  const clauses = [];
  let values = [];

  Object.entries(query).forEach(([column, value]) => {
    switch (column) {
      case 'date_added':
        // Use the date provided in compare_to 
        // TODO: Tidy this
        if (isComparison && query.compare_to) {
          values = values.concat(query.compare_to.split('AND'));
        } else {
          values = values.concat(value.split('AND'));
        }
        clauses.push(`date_added BETWEEN $${values.length - 1} AND $${values.length}`);
        break;

      case 'date_closed':
        // Use the date provided in compare_to 
        // TODO: Tidy this
        if (isComparison && query.compare_to) {
          values = values.concat(query.compare_to.split('AND'));
        } else {
          values = values.concat(value.split('AND'));
        }
        clauses.push(`date_closed BETWEEN $${values.length - 1} AND $${values.length}`);
        break;

      case 'outcome':
        clauses.push(generateOutcomeString(value));
        break;

      case 'duration':
        clauses.push(generateDurationString(value));
        break;

      case 'status':
        values.push(value);
        clauses.push(`status = $${values.length}`);
        break;

      default:
        break;
    }
  });

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const breakdown = `
    WITH data as (
      SELECT 
        ${type === 'duration' 
          ? `CASE (${generateDurationString('Ongoing')}) WHEN true THEN 'Recurring' ELSE 'Once Off' END as duration` 
          : `CASE is_new WHEN true THEN 'New' ELSE 'Existing' END as client_type`
        }, 
        COUNT(id) as total, 
        COUNT(id) FILTER(WHERE status = 'Open') as open_enquiries,
        COUNT (id) FILTER(WHERE ${generateOutcomeString('Won')}) as wins, 
        ${generateSumTotalString()} as pipeline_turnover, 
        ${generateSumTotalString('Won')} as estimated_won_revenue, 
        ${wonRevenueString} as actual_won_revenue, 
        ROUND(AVG(date_closed - date_added) FILTER(WHERE status = 'Closed' AND date_closed IS NOT NULL), 0) as avg_velocity 
      FROM pipeline 
      ${whereClause} 
      GROUP BY ${type}
    ) 
    SELECT 
      *,
      ROUND(wins::numeric / (CASE total WHEN 0 THEN 1 ELSE total END), 4) as close_rate, 
      ROUND(actual_won_revenue::numeric / (CASE pipeline_turnover WHEN 0 THEN 1 ELSE pipeline_turnover END), 4) as revenue_close_rate   
    FROM data 
  `;

  const overview = `
    WITH data as (
      SELECT 
        COUNT(id) as total, 
        COUNT(id) FILTER(WHERE status = 'Open') as open_enquiries,
        COUNT (id) FILTER(WHERE ${generateOutcomeString('Won')}) as wins, 
        ${generateSumTotalString()} as pipeline_turnover, 
        ${generateSumTotalString('Won')} as estimated_won_revenue, 
        ${wonRevenueString} as actual_won_revenue,  
        ROUND(AVG(date_closed - date_added) FILTER(WHERE status = 'Closed' AND date_closed IS NOT NULL), 0) as avg_velocity 
      FROM pipeline 
      ${whereClause} 
    ) 
    SELECT 
      *,
      ROUND(wins::numeric / (CASE total WHEN 0 THEN 1 ELSE total END), 4) as close_rate,
      ROUND(actual_won_revenue::numeric / (CASE pipeline_turnover WHEN 0 THEN 1 ELSE pipeline_turnover END), 4) as revenue_close_rate 
    FROM data 
  `;

  return { overview, breakdown, values };
};

const generateChannelBreakdownQuery = (query, isComparison) => {
  const clauses = [];
  let values = [];

  Object.entries(query).forEach(([column, value]) => {
    switch (column) {
      case 'date_added':
        // Use the date provided in compare_to 
        // TODO: Tidy this
        if (isComparison && query.compare_to) {
          values = values.concat(query.compare_to.split('AND'));
        } else {
          values = values.concat(value.split('AND'));
        }
        clauses.push(`date_added BETWEEN $${values.length - 1} AND $${values.length}`);
        break;

      case 'date_closed':
        // Use the date provided in compare_to 
        // TODO: Tidy this
        if (isComparison && query.compare_to) {
          values = values.concat(query.compare_to.split('AND'));
        } else {
          values = values.concat(value.split('AND'));
        }
        clauses.push(`date_closed BETWEEN $${values.length - 1} AND $${values.length}`);
        break;

      case 'outcome':
        clauses.push(generateOutcomeString(value));
        break;

      case 'duration':
        clauses.push(generateDurationString(value));
        break;

      case 'status':
        values.push(value);
        clauses.push(`status = $${values.length}`);
        break;

      default:
        break;
    }
  });

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const text = `
    WITH data as (
      SELECT 
        key as channel, 
        COUNT(id) as total, 
        COUNT(id) FILTER(WHERE status = 'Open') as open_enquiries,
        COUNT(id) FILTER(WHERE value @> '{"outcome":"Won"}') as wins,  
        (CASE key
          WHEN 'Analytics' THEN SUM(COALESCE(analytics_12mv, 0)) 
          WHEN 'CRO' THEN SUM(COALESCE(cro_12mv, 0)) 
          WHEN 'Content' THEN SUM(COALESCE(content_12mv, 0)) 
          WHEN 'Creative' THEN SUM(COALESCE(creative_12mv, 0)) 
          WHEN 'Email' THEN SUM(COALESCE(email_12mv, 0))
          WHEN 'PPC' THEN SUM(COALESCE(ppc_12mv, 0))
          WHEN 'SEO' THEN SUM(COALESCE(seo_12mv, 0))
          WHEN 'Social' THEN SUM(COALESCE(social_12mv, 0))
        ELSE 0
        END) as pipeline_turnover, 
        (CASE key
          WHEN 'Analytics' THEN SUM(COALESCE(analytics_12mv, 0)) FILTER(WHERE value @> '{"outcome":"Won"}')
          WHEN 'CRO' THEN SUM(COALESCE(cro_12mv, 0)) FILTER(WHERE value @> '{"outcome":"Won"}')
          WHEN 'Content' THEN SUM(COALESCE(content_12mv, 0)) FILTER(WHERE value @> '{"outcome":"Won"}')
          WHEN 'Creative' THEN SUM(COALESCE(creative_12mv, 0)) FILTER(WHERE value @> '{"outcome":"Won"}')
          WHEN 'Email' THEN SUM(COALESCE(email_12mv, 0)) FILTER(WHERE value @> '{"outcome":"Won"}')
          WHEN 'PPC' THEN SUM(COALESCE(ppc_12mv, 0)) FILTER(WHERE value @> '{"outcome":"Won"}')
          WHEN 'SEO' THEN SUM(COALESCE(seo_12mv, 0)) FILTER(WHERE value @> '{"outcome":"Won"}')
          WHEN 'Social' THEN SUM(COALESCE(social_12mv, 0)) FILTER(WHERE value @> '{"outcome":"Won"}')
        ELSE 0
        END) as estimated_won_revenue,
        COALESCE(SUM(NULLIF(value->>'won_revenue', '')::numeric) FILTER(WHERE value @> '{"outcome":"Won"}'), 0) as actual_won_revenue,   
        ROUND(AVG(date_closed - date_added) FILTER(WHERE status = 'Closed' AND date_closed IS NOT NULL), 0) as avg_velocity 
      FROM pipeline  
      CROSS JOIN LATERAL jsonb_each(channel_data) channels 
      ${whereClause} 
    GROUP BY key
    ) 
    SELECT 
      *,
      ROUND(wins::numeric / (CASE total WHEN 0 THEN 1 ELSE total END), 4) as close_rate,
      ROUND(actual_won_revenue::numeric / (CASE pipeline_turnover WHEN 0 THEN 1 ELSE pipeline_turnover END), 4) as revenue_close_rate  
    FROM data 
  `;

  return { text, values };
};

const generateDownloadOverviewQuery = query => {
  const { whereClause, values } = generateWhereClause(query);

  const dateCol = query.date_closed ? 'date_closed' : 'date_added';

  const text = `
    WITH data as (
      SELECT 
        TO_CHAR(DATE_TRUNC('month', ${dateCol}), 'yyyy-MM-dd') as date, 
        COUNT(id) as total, 
        COUNT(id) FILTER(WHERE status = 'Open') as open_enquiries,
        COUNT (id) FILTER(WHERE ${generateOutcomeString('Won')}) as wins, 
        ${generateSumTotalString()} as pipeline_turnover, 
        ${generateSumTotalString('Won')} as estimated_won_revenue, 
        ${wonRevenueString} as actual_won_revenue,  
        ROUND(AVG(date_closed - date_added) FILTER(WHERE status = 'Closed' AND date_closed IS NOT NULL), 0) as avg_velocity 
      FROM pipeline 
      ${whereClause} 
      GROUP BY date 
      ORDER BY date DESC
    ) 
    SELECT 
      *,
      ROUND(wins::numeric / (CASE total WHEN 0 THEN 1 ELSE total END), 4) as close_rate, 
      ROUND(actual_won_revenue::numeric / (CASE pipeline_turnover WHEN 0 THEN 1 ELSE pipeline_turnover END), 4) as revenue_close_rate 
    FROM data 
  `;

  return { text, values };
};

const generateDownloadOverviewBreakdownQuery = query => {
  const { whereClause, values } = generateWhereClause(query);

  const dateCol = query.date_closed ? 'date_closed' : 'date_added';

  const text = `
    WITH data as (
      SELECT 
        TO_CHAR(DATE_TRUNC('month', ${dateCol}), 'yyyy-MM-dd') as date,
        CASE (${generateDurationString('Ongoing')}) WHEN true THEN 'Recurring' ELSE 'Once Off' END as duration, 
        COUNT(id) as total, 
        COUNT(id) FILTER(WHERE status = 'Open') as open_enquiries,
        COUNT (id) FILTER(WHERE ${generateOutcomeString('Won')}) as wins, 
        ${generateSumTotalString()} as pipeline_turnover, 
        ${generateSumTotalString('Won')} as estimated_won_revenue, 
        ${wonRevenueString} as actual_won_revenue, 
        ROUND(AVG(date_closed - date_added) FILTER(WHERE status = 'Closed' AND date_closed IS NOT NULL), 0) as avg_velocity 
      FROM pipeline 
      ${whereClause} 
      GROUP BY date, duration 
      ORDER BY date DESC, duration
    ) 
    SELECT 
      *,
      ROUND(wins::numeric / (CASE total WHEN 0 THEN 1 ELSE total END), 2) as close_rate, 
      ROUND(actual_won_revenue::numeric / (CASE pipeline_turnover WHEN 0 THEN 1 ELSE pipeline_turnover END), 4) as revenue_close_rate 
    FROM data 
  `;

  return { text, values };
};

module.exports = {
  generateSelectAllQuery,
  generateSelectOneQuery,
  generateCreateQuery,
  generateUpdateQuery,
  generateOverviewQuery,
  generateChannelBreakdownQuery,
  generateDownloadOverviewQuery,
  generateDownloadOverviewBreakdownQuery
};