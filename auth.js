'use strict';

const Roles = {
  ADMIN: 'Admin',
  DEPARTMENT_HEAD: 'Department Head',
  CLIENT_LEAD: 'Client Lead'
};

const getCognitoId = (req) => req.apiGateway.event.requestContext.authorizer.claims['cognito:username'];

const isAuthorised = async (id, roles, pool) => {
  try {
    const result = await pool.query({
      text: `
        SELECT ARRAY_AGG(role_name) roles 
        FROM user_roles 
        JOIN roles ON roles.role_id = user_roles.role_id
        WHERE user_id = $1
      `,
      values: [id]
    });

    if (result.rows.length > 0) {
      if (Array.isArray(roles)) {
        return result.rows[0].roles.some(role => roles.includes(role));
      }
      return result.rows[0].roles.includes(roles);
    }
    return false;
  } catch (e) {
    return false;
  }
};

module.exports = {
  Roles,
  getCognitoId,
  isAuthorised
};