'use strict';

const express = require('express');
const serverless = require('aws-serverless-express');

const { app, getPool } = require('./app');
const { isAuthorised, getCognitoId, Roles } = require('./auth');
const {
  generateSelectAllQuery,
  generateSelectOneQuery,
  generateCreateQuery,
  generateUpdateQuery,
  generateOverviewQuery,
  generateChannelBreakdownQuery,
  generateDownloadOverviewQuery,
  generateDownloadOverviewBreakdownQuery
} = require('./pipelineUtils');

const router = express.Router();

// Get all enquiries
router.get('/', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    const { text, values } = generateSelectAllQuery(req.query);
    const result = await pool.query({ text, values });
    res.status(200).json(result.rows);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// Download CSV file of current selection
router.get('/download', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    const { text, values } = generateSelectAllQuery(req.query, false);
    const result = await pool.query({ text, values });
    res.status(200).json(result.rows);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// Get enquiry by ID
router.get('/e/:id', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    const { text, values } = generateSelectOneQuery(req.params.id);
    const result = await pool.query({ text, values });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No matching result found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// Create enquiry
router.post('/', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    const { text, values } = generateCreateQuery(req.body);
    await pool.query({ text, values });
    res.status(201).json({ message: 'Enquiry created' });
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    console.error(e);
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// Update enquiry
router.post('/e/:id', async (req, res) => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], client)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    const {
      updateText,
      updateValues,
      deleteOldLeadsText,
      deleteLeadsValues,
      insertNewLeadsText,
      resultText,
      resultsValues
    } = generateUpdateQuery(req.params.id, req.body);

    await client.query('BEGIN');
    if (deleteOldLeadsText) await client.query({ text: deleteOldLeadsText, values: deleteLeadsValues });
    if (insertNewLeadsText) await client.query(insertNewLeadsText);
    await client.query({ text: updateText, values: updateValues });
    await client.query('COMMIT');

    const result = await client.query({ text: resultText, values: resultsValues });
    res.status(200).json(result.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    client.release();
    await pool.end();
  }
});

// Delete enquiry
router.delete('/e/:id', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);
    const { id } = req.params;

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    await pool.query({
      text: 'DELETE FROM pipeline WHERE id = $1',
      values: [id]
    });
    res.status(200).json({ message: 'Enquiry deleted' });
  } catch (e) {
    console.log(e);
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// Get dashboard overview metrics
router.get('/dashboard/overview', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    // TODO: Make all this nicer
    const { overview, breakdown, values } = generateOverviewQuery(req.query, 'duration');
    const comparison = generateOverviewQuery(req.query, 'duration', true);

    const clientOverview = generateOverviewQuery(req.query, 'client_type');
    const clientComparison = generateOverviewQuery(req.query, 'client_type', true);

    const clientResult = await pool.query({ text: clientOverview.breakdown, values: clientOverview.values });
    const clientComparisonResult = await pool.query({ text: clientComparison.breakdown, values: clientComparison.values });

    const overviewResult = await pool.query({ text: overview, values });
    const breakdownResult = await pool.query({ text: breakdown, values });
    const overviewComparison = await pool.query({ text: comparison.overview, values: comparison.values });
    const breakdownComparison = await pool.query({ text: comparison.breakdown, values: comparison.values });

    res.status(200).json({ 
      overview: overviewResult.rows[0], 
      overviewComparison: req.query.compare_to ? overviewComparison.rows[0] : [],
      breakdown: breakdownResult.rows.concat(clientResult.rows),
      breakdownComparison: req.query.compare_to ? breakdownComparison.rows.concat(clientComparisonResult.rows) : []
    });
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// Get dashboard channel metrics
router.get('/dashboard/channels', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    const { text, values } = generateChannelBreakdownQuery(req.query);
    const comparison = generateChannelBreakdownQuery(req.query, true);
    const result = await pool.query({ text, values });
    const comparisonResult = await pool.query({ text: comparison.text, values: comparison.values });

    res.status(200).json({ 
      result: result.rows, 
      comparison: req.query.compare_to ? comparisonResult.rows : [],
    });
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// Get dashboard overview grouped by month for download
router.get('/dashboard/overview/download', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    const { text, values } = generateDownloadOverviewQuery(req.query);

    const result = await pool.query({ text, values });

    res.status(200).json(result.rows);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// Get dashboard breakdown grouped by month for download
router.get('/dashboard/breakdown/download', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    const { text, values } = generateDownloadOverviewBreakdownQuery(req.query);
    const result = await pool.query({ text, values });
    res.status(200).json(result.rows);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// Get breakdown across all channels
router.get('/dashboard/channels', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(403).json({ error: 'You are not authorised to perform this action' });
    }

    const { text, values } = generateChannelBreakdownQuery(req.query);
    const result = await pool.query({ text, values });
    res.status(200).json(result.rows);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(500).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

app.use('/pipeline', router);

const server = serverless.createServer(app);

exports.handler = (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  serverless.proxy(server, event, context);
};
