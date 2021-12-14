'use strict';

const express = require('express');
const cors = require('cors')
const { Pool, types } = require('pg');
const awsServerlessExpressMiddleware = require('aws-serverless-express/middleware');

const app = express();

app.use(cors());
app.use(express.json({ extended: true }));
app.use(awsServerlessExpressMiddleware.eventContext());

// These prevents number types from being returned as string
// Don't use if number can be bigger than int4 (+/- 2,147,483,648)
// Integer
types.setTypeParser(20, (val) => {
  return parseInt(val, 10)
})
// Numeric
types.setTypeParser(1700, (val) => {
  return parseFloat(val);
});

let pool = undefined;

const getPool = () => {
  if (typeof pool === 'undefined') {
    return new Pool({
      min: 0,
      max: 5,
      ssl: true,
      idleTimeoutMillis: 120000,
      connectionTimeoutMillis: 10000,
      connectionString: process.env.DATABASE_URI
    });
  }
  return pool;
};

module.exports = {
  app,
  getPool
};