'use strict';

const express = require('express');
const serverless = require('aws-serverless-express');

const { app, getPool } = require('./app');
const { getCognitoId, isAuthorised, Roles } = require('./auth');

const router = express.Router();

router.get('/', async (req, res) => {
  const pool = getPool();

  try {

    const result = await pool.query(`
      WITH dept AS (
        SELECT 
          ud.user_id user_id,
          JSON_AGG(ROW_TO_JSON(d)) departments
        FROM 
            user_departments ud 
        JOIN 
            departments d ON d.department_id = ud.department_id 
        GROUP BY ud.user_id
      )
      SELECT
        u.user_id,
        username,
        (SELECT departments FROM dept WHERE dept.user_id = u.user_id)
      FROM 
        users u
      GROUP BY u.user_id 
      ORDER BY username
    `);

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

router.get('/me', async (req, res) => {
  const pool = getPool();

  try {
    const id = getCognitoId(req);

    const result = await pool.query({
      text: `
        WITH dept AS (
          SELECT 
            ud.user_id user_id,
            JSON_AGG(ROW_TO_JSON(d)) departments
          FROM 
              user_departments ud 
          JOIN 
              departments d ON d.department_id = ud.department_id 
          GROUP BY ud.user_id
        ),
        user_role AS (
          SELECT 
            ur.user_id user_id,
            JSON_AGG(ROW_TO_JSON(r)) roles
          FROM 
            user_roles ur 
          JOIN 
            roles r ON r.role_id = ur.role_id 
          GROUP BY ur.user_id
        )
        SELECT
          u.user_id,
          username,
          email,
          (SELECT departments FROM dept WHERE dept.user_id = u.user_id),
          (SELECT roles FROM user_role WHERE user_role.user_id = u.user_id)
        FROM 
          users u 
        WHERE u.user_id = $1 
        GROUP BY u.user_id 
      `,
      values: [id]
    });

    if (result.rows.length > 0) {
      res.status(200).json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'This user could not be found' });
    }
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

router.get('/info', async (req, res) => {
  const pool = getPool();

  try {
    const id = getCognitoId(req);

    if (!await isAuthorised(id, [Roles.ADMIN, Roles.DEPARTMENT_HEAD, Roles.CLIENT_LEAD], pool)) {
      return res.status(401).json({ error: 'You are not authorised to perform this action' });
    }

    const result = await pool.query(`
        WITH dept AS (
          SELECT 
            ud.user_id user_id,
            JSON_AGG(ROW_TO_JSON(d)) departments
          FROM 
              user_departments ud 
          JOIN 
              departments d ON d.department_id = ud.department_id 
          GROUP BY ud.user_id
        ),
        user_role AS (
          SELECT 
            ur.user_id user_id,
            JSON_AGG(ROW_TO_JSON(r)) roles
          FROM 
            user_roles ur 
          JOIN 
            roles r ON r.role_id = ur.role_id 
          GROUP BY ur.user_id
        )
        SELECT
          u.user_id,
          username,
          email,
          (SELECT departments FROM dept WHERE dept.user_id = u.user_id),
          (SELECT roles FROM user_role WHERE user_role.user_id = u.user_id)
        FROM 
          users u  
        GROUP BY u.user_id 
      `
    );
    
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

router.get('/me/notifications', async (req, res) => {
  const pool = getPool();

  try {
    const id = getCognitoId(req);

    const result = await pool.query({
      text: 'SELECT * FROM review_responses WHERE manager_id = $1 OR employee_id = $1',
      values: [id]
    });

    let notifications = result.rows.reduce((acc, curr) => {
      if ((curr.manager_id === id && Object.keys(curr.manager_form_data).length === 0) ||
        (curr.employee_id === id && Object.keys(curr.employee_form_data).length === 0)) {
        acc.push({
          icon: 'calendar',
          text: 'A monthly review is ready for your input',
          actionUrl: `/user/monthly-reviews/r/${curr.review_id}/response/${curr.response_id}`,
        });
      }
      return acc;
    }, []);

    if (await isAuthorised(id, [Roles.ADMIN, Roles.CLIENT_LEAD, Roles.DEPARTMENT_HEAD], pool)) {
      const enquiries = await pool.query({
        text: `
          SELECT 
            DISTINCT id, 
            company_name,
            channels, 
            ppc_12mv,
            seo_12mv,
            content_12mv,
            email_12mv,
            social_12mv,
            creative_12mv,
            cro_12mv,
            analytics_12mv, 
            DATE_PART('day', NOW() - last_updated) AS time_difference  
          FROM proposal_leads 
          JOIN pipeline ON pipeline.id = enquiry_id 
          CROSS JOIN LATERAL jsonb_each(channel_data) channels
          WHERE value @> '{"status":"Open"}' OR status = 'Open' 
          AND user_id = $1 
          AND last_updated < NOW() - INTERVAL '1 days' 
          GROUP BY id
        `,
        values: [id]
      });
      enquiries.rows.forEach(enquiry => {
        if (enquiry.time_difference >= 7) {
          notifications.push({
            icon: 'bell',
            text: `An enquiry for ${enquiry.company_name} has not been updated in ${enquiry.time_difference} days`,
            actionUrl: `/pipeline/e/${enquiry.id}`,
            iconColour: 'orange'
          });
        }
        enquiry.channels.forEach(channel => {
          if (!enquiry[`${channel.toLowerCase()}_12mv`]) {
            notifications.push({
              icon: 'warning-2',
              text: `An enquiry for ${enquiry.company_name} is missing 12M value for ${channel}`,
              actionUrl: `/pipeline/e/${enquiry.id}`,
              iconColour: 'orange'
            });
          }
        });
      });
    }

    res.status(200).json(notifications);
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

router.post('/me', async (req, res) => {
  const pool = getPool();

  try {
    const id = getCognitoId(req);

    const { key, value } = req.body;

    if (['username', 'email'].includes(key)) {
      await pool.query({
        text: `
          UPDATE users 
          SET ${key} = $1 
          WHERE user_id = $2
        `,
        values: [value, id]
      });
    } else if (key === 'department') {
      const { previousId, nextId } = value;

      await pool.query({
        text: 'DELETE FROM user_departments WHERE user_id = $1 AND department_id = $2',
        values: [id, previousId]
      });

      await pool.query({
        text: 'INSERT INTO user_departments(user_id, department_id) VALUES($1, $2)',
        values: [id, nextId]
      });
    } else {
      return res.status(401).json({ error: 'You are not authorised to perform this action' });
    }

    const result = await pool.query({
      text: `
        WITH dept AS (
          SELECT 
            ud.user_id user_id,
            JSON_AGG(ROW_TO_JSON(d)) departments
          FROM 
              user_departments ud 
          JOIN 
              departments d ON d.department_id = ud.department_id 
          GROUP BY ud.user_id
        ),
        user_role AS (
          SELECT 
            ur.user_id user_id,
            JSON_AGG(ROW_TO_JSON(r)) roles
          FROM 
            user_roles ur 
          JOIN 
            roles r ON r.role_id = ur.role_id 
          GROUP BY ur.user_id
        )
        SELECT
          u.user_id,
          username,
          email,
          (SELECT departments FROM dept WHERE dept.user_id = u.user_id),
          (SELECT roles FROM user_role WHERE user_role.user_id = u.user_id)
        FROM 
          users u 
        WHERE u.user_id = $1 
        GROUP BY u.user_id 
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

router.get('/u/:id', async (req, res) => {
  const pool = getPool();

  try {
    const { id } = req.params;

    const result = await pool.query({
      text: `
        WITH dept AS (
          SELECT 
            ud.user_id user_id,
            JSON_AGG(ROW_TO_JSON(d)) departments
          FROM
            user_departments ud 
          JOIN 
            departments d ON d.department_id = ud.department_id 
          GROUP BY ud.user_id
        )
        SELECT
          u.user_id,
          username,
          (SELECT departments FROM dept WHERE dept.user_id = u.user_id)
        FROM 
          users u
        WHERE u.user_id = $1 
        GROUP BY u.user_id
      `,
      values: [id]
    });

    if (result.rows.length > 0) {
      res.status(200).json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'This user could not be found' });
    }
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

router.post('/u/:id', async (req, res) => {
  const pool = getPool();

  try {
    const id = getCognitoId(req);

    if (!await isAuthorised(id, [Roles.ADMIN, Roles.DEPARTMENT_HEAD], pool)) {
      return res.status(401).json({ error: 'You are not authorised to perform this action' });
    }

    const { userId, departments, roles } = req.body;

    await pool.query({
      text: 'DELETE FROM user_departments WHERE user_id = $1',
      values: [userId]
    });

    // TODO make this 1 query / transaction
    for (let i = 0; i < departments.length; i++) {
      await pool.query({
        text: 'INSERT INTO user_departments(user_id, department_id) VALUES($1, $2)',
        values: [userId, departments[i]]
      });
    }

    await pool.query({
      text: 'DELETE FROM user_roles WHERE user_id = $1',
      values: [userId]
    });

    for (let i = 0; i < roles.length; i++) {
      await pool.query({
        text: 'INSERT INTO user_roles(user_id, role_id) VALUES($1, $2)',
        values: [userId, roles[i]]
      });
    }

    res.status(200).json({ message: 'Update successful' });
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

app.use('/users', router);

const server = serverless.createServer(app);

exports.handler = (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  serverless.proxy(server, event, context);
};