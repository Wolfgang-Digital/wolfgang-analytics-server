'use strict';

const express = require('express');
const serverless = require('aws-serverless-express');

const { app, getPool } = require('./app');
const { getCognitoId } = require('./auth');

const router = express.Router();

router.get('/posts', async (req, res) => {
  const pool = getPool();
  
  try {
    const id = getCognitoId(req);

    const result = await pool.query({
      text: `
        SELECT 
          post_id,
          username,
          title,
          tags,
          created_at, 
          COALESCE((SELECT SUM(vote_value) FROM post_votes WHERE post_id = posts.post_id), 0) vote_score, 
          (SELECT vote_value FROM post_votes WHERE post_id = posts.post_id AND user_id = $1) user_vote,
          COALESCE((SELECT COUNT(*) FROM post_comments WHERE post_id = posts.post_id), 0) num_comments  
        FROM posts 
        JOIN users ON users.user_id = posts.user_id 
        ORDER BY created_at DESC
      `,
      values: [id]
    });

    return res.status(200).json(result.rows);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(400).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

router.post('/posts', async (req, res) => {
  const pool = getPool();
  
  try {
    const id = getCognitoId(req);

    const { title, text, tags } = req.body;

    const result = await pool.query({
      text: `
        INSERT INTO posts(user_id, title, body, tags) 
        VALUES($1, $2, $3, $4) 
        RETURNING * 
      `,
      values: [id, title, text, tags]
    });

    await pool.query({
      text: `INSERT INTO post_votes(post_id, user_id, vote_value) VALUES($1, $2, 1)`,
      values: [result.rows[0].post_id, id]
    });

    res.status(200).json(result.rows[0]);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(400).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

router.get('/posts/p/:id', async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const userId = getCognitoId(req);

    const result = await pool.query({
      text: `
        SELECT 
          post_id,
          username,
          title,
          body, 
          tags,
          created_at,
          COALESCE((SELECT SUM(vote_value) FROM post_votes WHERE post_id = $1), 0) vote_score, 
          (SELECT vote_value FROM post_votes WHERE post_id = posts.post_id AND user_id = $2) user_vote,
          COALESCE((SELECT COUNT(*) FROM post_comments WHERE post_id = posts.post_id), 0) num_comments   
        FROM posts 
        JOIN users ON users.user_id = posts.user_id 
        WHERE post_id = $1 
        ORDER BY created_at DESC
      `,
      values: [id, userId]
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `No post found with ID: ${id}` });
    }
    return res.status(200).json(result.rows[0]);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(400).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// TODO: Change to pg transaction
router.post('/posts/p/:id/vote', async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const userId = getCognitoId(req);
    const { value } = req.body;

    const result = await pool.query({
      text: 'SELECT * FROM post_votes WHERE post_id = $1 AND user_id = $2',
      values: [id, userId]
    });

    if (result.rows.length === 0) {
      const returnValue = await pool.query({
        text: `
          INSERT INTO post_votes(post_id, user_id, vote_value) 
          VALUES($1, $2, $3) 
          RETURNING *
        `,
        values: [id, userId, value]
      });
      return res.status(200).json(returnValue.rows[0]);

    } else if (result.rows[0].vote_value === value) {
      await pool.query({
        text: 'DELETE FROM post_votes WHERE post_id = $1 AND user_id = $2',
        values: [id, userId]
      });
      return res.status(200).json({ post_id: id, user_id: userId, vote_value: 0 });

    } else {
      const returnValue = await pool.query({
        text: 'UPDATE post_votes SET vote_value = $3 WHERE post_id = $1 AND user_id = $2 RETURNING *',
        values: [id, userId, value]
      });
      return res.status(200).json(returnValue.rows[0]);
    }
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(400).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

router.post('/posts/p/:id/comment', async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const userId = getCognitoId(req);
    const { parentId, body, username, sortKey } = req.body;

    const result = await pool.query({
      text: 'INSERT INTO post_comments(post_id, parent_comment_id, user_id, body) VALUES($1, $2, $3, $4) RETURNING *',
      values: [id, parentId, userId, body]
    });

    await pool.query({
      text: `INSERT INTO comment_votes(comment_id, user_id, vote_value) VALUES($1, $2, 1)`,
      values: [result.rows[0].comment_id, userId]
    });

    res.status(200).json({
      ...result.rows[0],
      username,
      user_vote: 1,
      vote_score: 1,
      sort_key: sortKey.concat(result.rows[0].comment_id),
      depth: sortKey.length
    });
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(400).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

router.get('/posts/p/:id/comments', async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const userId = getCognitoId(req);

    const result = await pool.query({
      text: `
        WITH RECURSIVE replies AS (
          SELECT 
          comment_id, 
          post_id, 
          user_id, 
          parent_comment_id, 
          body,  
          created_at::text, 
          ARRAY[comment_id]::int[] sort_key, 
          0 AS depth 
          FROM post_comments 
        WHERE parent_comment_id is null
        UNION
          SELECT 
            p.comment_id, 
            p.post_id, 
            p.user_id, 
            p.parent_comment_id, 
            p.body, 
            p.created_at::text,
            array_append(r.sort_key, p.comment_id),
            depth + 1 AS depth 
          FROM post_comments p 
          INNER JOIN replies r
            ON p.parent_comment_id = r.comment_id 
        )
        SELECT
          comment_id, 
          username,
          body, 
          created_at, 
          COALESCE(
            (SELECT SUM(vote_value) FROM comment_votes cv WHERE cv.comment_id = r.comment_id),
          0) vote_score, 
          (SELECT vote_value FROM comment_votes cv WHERE cv.comment_id = r.comment_id AND cv.user_id = $2) user_vote, 
          sort_key,
          depth 
        FROM replies r 
        JOIN users ON users.user_id = r.user_id 
        WHERE r.post_id = $1 AND r.depth < $3 
        ORDER BY vote_score DESC, r.depth
      `,
      values: [id, userId, 10]
    });

    return res.status(200).json(result.rows);
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(400).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

// TODO: Change to pg transaction
router.post('/comments/c/:id/vote', async (req, res) => {
  const pool = getPool();
  
  try {
    const { id } = req.params;
    const userId = getCognitoId(req);
    const { value } = req.body;

    const result = await pool.query({
      text: 'SELECT * FROM comment_votes WHERE comment_id = $1 AND user_id = $2',
      values: [id, userId]
    });

    if (result.rows.length === 0) {
      const returnValue = await pool.query({
        text: `
          INSERT INTO comment_votes(comment_id, user_id, vote_value) 
          VALUES($1, $2, $3) 
          RETURNING *
        `,
        values: [id, userId, value]
      });
      return res.status(200).json(returnValue.rows[0]);

    } else if (result.rows[0].vote_value === value) {
      await pool.query({
        text: 'DELETE FROM comment_votes WHERE comment_id = $1 AND user_id = $2',
        values: [id, userId]
      });
      return res.status(200).json({ comment_id: id, user_id: userId, vote_value: 0 });

    } else {
      const returnValue = await pool.query({
        text: 'UPDATE comment_votes SET vote_value = $3 WHERE comment_id = $1 AND user_id = $2 RETURNING *',
        values: [id, userId, value]
      });
      return res.status(200).json(returnValue.rows[0]);
    }
  } catch (e) {
    // Return error message in response body for easy debugging.
    // INSECURE - CHANGE FOR PROD
    res.status(400).json({
      error: e.toString()
    });
  } finally {
    await pool.end();
  }
});

app.use('/awarewolf', router);

const server = serverless.createServer(app);

module.exports.handler = (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  serverless.proxy(server, event, context);
};