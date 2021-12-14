'use strict';

const AWS = require('aws-sdk');
const express = require('express');
const serverless = require('aws-serverless-express');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const { app, getPool } = require('./app');
const { getCognitoId } = require('./auth');

const S3 = new AWS.S3();
const s3Bucket = 'wg-forestry';

const router = express.Router();

const MARGIN = 12;
const colour1 = rgb(0.082, 0.376, 0.4);
const colour2 = rgb(0.18, 0.58, 0.56);

const printText = (text, y, color, size, { page, font, width }) => {
  const textWidth = font.widthOfTextAtSize(text, size);
  const textHeight = font.heightAtSize(size);
  page.drawText(text, { x: (width / 2) - (textWidth / 2), y: y - textHeight, size, font, color });
  return textHeight;
};

router.post('/create-preview', async (req, res) => {
  const pool = getPool();

  try {
    const userId = getCognitoId(req);
    const { heading, recipient, content, marginTop } = req.body;

    const template = await S3.getObject({
      Bucket: s3Bucket,
      Key: 'previews/template_alt_compressed.pdf'
    }).promise();

    const doc = await PDFDocument.load(template.Body);
    const page = doc.getPages()[0];
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();
    const data = { page, font, width };
    
    const margin = marginTop < 0 ? Math.abs(marginTop) : -marginTop;

    let y = ((height / 100) * 72) + margin;
 
    y -= printText(heading, y, colour1, 12, data) + MARGIN;
  
    y -= printText(recipient.toUpperCase(), y, colour2, 42, data) + (MARGIN * 2);
  
    if (Array.isArray(content)) {
      for (let i = 0; i < content.length; i++) {
        y -= printText(content[i].value, y, colour1, 12, data) + MARGIN;
      }
    }

    const bytes = await doc.save();
    const buffer = Buffer.from(bytes);

    const uploadParams = {
      Bucket: s3Bucket,
      Key: `previews/${userId}.pdf`,
      Body: buffer,
      ContentType: 'application/pdf',
      ACL: 'public-read'
    };
    await S3.putObject(uploadParams).promise();

    return res.status(200).json({ uri: `https://${s3Bucket}.s3.amazonaws.com/previews/${userId}.pdf` });
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

app.use('/forestry', router);

const server = serverless.createServer(app);

module.exports.handler = (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  serverless.proxy(server, event, context);
};