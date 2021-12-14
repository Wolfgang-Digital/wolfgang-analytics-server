'use strict';

const express = require('express');
const serverless = require('aws-serverless-express');

const { app, getPool } = require('./app');
const { getCognitoId, isAuthorised, Roles } = require('./auth');

const router = express.Router();

router.get('/', async (req, res) => {
  const pool = getPool();
  
  try {
    const id = getCognitoId(req);

    const result = await pool.query({
      text: `
        SELECT 
          review_id,
          manager_id,
          employee_id,
          u1.username manager_name,
          u2.username employee_name,
          department,
          form_data,
          created_on 
        FROM reviews 
        JOIN users u1 ON manager_id = u1.user_id
        JOIN users u2 ON employee_id = u2.user_id 
        WHERE manager_id = $1 OR employee_id = $1 
        ORDER BY created_on DESC
      `,
      values: [id]
    });

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

router.post('/', async (req, res) => {
  const pool = getPool();
  
  try {
    const id = getCognitoId(req);

    if (!await isAuthorised(id, [Roles.ADMIN, Roles.DEPARTMENT_HEAD], pool)) {
      return res.status(401).json({ error: 'You are not authorised to perform this action' });
    }

    const { employeeId, managerId, department, formData } = req.body;

    const result = await pool.query({
      text: 'INSERT INTO reviews (employee_id, manager_id, department, form_data) VALUES($1, $2, $3, $4) RETURNING *',
      values: [employeeId, managerId, department, formData]
    });

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

router.get('/r/:id', async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;

    const result = await pool.query({
      text: `
        SELECT 
          review_id,
          u1.username manager_name,
          u2.username employee_name,
          manager_id, 
          employee_id, 
          department,
          form_data,
          (
            SELECT JSON_AGG(ROW_TO_JSON(review_responses)) 
            FROM review_responses 
            WHERE review_id = $1 
          ) responses 
        FROM reviews
        JOIN users u1 ON manager_id = u1.user_id
        JOIN users u2 ON employee_id = u2.user_id 
        WHERE review_id = $1 
        GROUP BY
          review_id,
          manager_name,
          employee_name, 
          manager_id, 
          employee_id
      `,
      values: [id]
    });

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

router.delete('/r/:id', async (req, res) => {
  const pool = getPool();
  
  try {
    const id = getCognitoId(req);

    if (!await isAuthorised(id, [Roles.ADMIN, Roles.DEPARTMENT_HEAD], pool)) {
      return res.status(401).json({ error: 'You are not authorised to perform this action' });
    }

    await pool.query({
      text: 'DELETE FROM reviews WHERE review_id = $1',
      values: [req.params.id]
    });

    res.status(200).json({ message: 'Delete successful' });
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

router.get('/r/:id/form', async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;

    const result = await pool.query({
      text: `
        SELECT 
          review_id,
          u1.username manager_name,
          u2.username employee_name,
          manager_id, 
          employee_id, 
          department,
          form_data 
        FROM reviews
        JOIN users u1 ON manager_id = u1.user_id
        JOIN users u2 ON employee_id = u2.user_id 
        WHERE review_id = $1 
        GROUP BY
          review_id,
          manager_name,
          employee_name, 
          manager_id, 
          employee_id
      `,
      values: [id]
    });

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

router.post('/r/:id/form', async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const { data } = req.body;

    const result = await pool.query({
      text: 'UPDATE reviews SET form_data = $1 WHERE review_id = $2 RETURNING *',
      values: [data, id]
    });

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

router.post('/r/:id/response', async (req, res) => {
  const pool = getPool();
  
  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD], pool)) {
      return res.status(401).json({ error: 'You are not authorised to perform this action' });
    }

    const { id } = req.params;
    const { date, employeeId } = req.body;

    const result = await pool.query({
      text: `
        INSERT INTO review_responses (review_id, review_date, manager_form_data, employee_form_data, manager_id, employee_id) 
        VALUES($1, $2, $3, $4, $5, $6) 
        RETURNING *`,
      values: [id, date, {}, {}, userId, employeeId]
    });

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

router.post('/response/:id', async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const { role, formData } = req.body;

    if (role === 'MANAGER' && !await isAuthorised(id, [Roles.ADMIN, Roles.DEPARTMENT_HEAD], pool)) {
      return res.status(401).json({ error: 'You are not authorised to perform this action' });
    }

    const result = await pool.query({
      text: `
        UPDATE review_responses 
        SET ${role === 'MANAGER' ? 'manager_form_data' : 'employee_form_data'} = $1 
        WHERE response_id = $2
        RETURNING *
      `,
      values: [formData, id]
    });

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

router.delete('/response/:id', async (req, res) => {
  const pool = getPool();
  
  try {
    const userId = getCognitoId(req);

    if (!await isAuthorised(userId, [Roles.ADMIN, Roles.DEPARTMENT_HEAD], pool)) {
      return res.status(401).json({ error: 'You are not authorised to perform this action' });
    }

    await pool.query({
      text: 'DELETE FROM review_responses WHERE response_id = $1',
      values: [req.params.id]
    });

    res.status(200).json({ message: 'Delete successful' });
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

router.get('/reports/:dept', async (req, res) => {
  const pool = getPool();
  
  try {
    const id = getCognitoId(req);

    if (!await isAuthorised(id, [Roles.ADMIN, Roles.DEPARTMENT_HEAD], pool)) {
      return res.status(401).json({ error: 'You are not authorised to perform this action' });
    }

    const { dept } = req.params;
    const { start, end } = req.query;

    const result = await pool.query({
      text: `
        SELECT 
          username employee, 
          review_date,
          department,
          manager_form_data,
          employee_form_data 
        FROM review_responses
        JOIN 
          reviews ON reviews.review_id = review_responses.review_id 
        JOIN 
          users ON users.user_id = review_responses.employee_id 
        WHERE 
          review_date BETWEEN $1 AND $2 
          AND department = $3
      `,
      values: [start, end, dept]
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No matching results found for that date range' });
    }

    const data = result.rows.reduce((acc, curr) => {
      // Sum metrics
      if (curr.manager_form_data.metrics) {
        Object.entries(curr.manager_form_data.metrics).forEach(([key, value]) => {
          if (acc.metrics[key]) {
            acc.metrics[key].total += value.value;
            acc.metrics[key].count++;
          } else {
            acc.metrics[key] = {
              name: key,
              total: value.value,
              count: 1
            };
          }
        });
      }

      // Sum pillars
      if (curr.manager_form_data.pillars) {
        Object.entries(curr.manager_form_data.pillars).forEach(([key, value]) => {
          if (acc.pillars[key]) {
            acc.pillars[key].total += value.score;
            acc.pillars[key].count++;
          } else {
            acc.pillars[key] = {
              name: key,
              total: value.score,
              count: 1
            };
          }
        });
      }

      // Sum questions
      const response = Object.entries(curr.employee_form_data);
      if (response.length > 0) {
        response.forEach(([sectionName, sectionValue]) => {
          if (!acc.sections[sectionName]) {
            acc.sections[sectionName] = {
              sectionName,
              questions: {}
            };
          }

          Object.entries(sectionValue).forEach(([question, answer]) => {
            if (answer.length > 0) {
              if (!acc.sections[sectionName].questions[question]) {
                acc.sections[sectionName].questions[question] = {
                  text: question,
                  answers: [{ username: curr.employee, answer }]
                }
              } else {
                acc.sections[sectionName].questions[question].answers.push({
                  username: curr.employee, answer
                });
              }
            }
          });
        });
      }

      return acc;
    }, {
      metrics: {},
      pillars: {},
      sections: {}
    });

    res.status(200).json({
      department: dept,
      start,
      end,
      data,
      rows: result.rows
    });
  } catch (e) {
    console.log(e);
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(400).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

app.use('/reviews', router);

const server = serverless.createServer(app);

module.exports.handler = (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  serverless.proxy(server, event, context);
};