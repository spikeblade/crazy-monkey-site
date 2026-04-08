/**
 * Shared test helpers for Netlify function tests.
 * All functions use native https.request — this helper mocks it.
 */
const { EventEmitter } = require('events');

const TEST_ENV = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  ADMIN_PASSWORD: 'test-admin-pass',
  MP_ACCESS_TOKEN: 'TEST-mp-token',
  RESEND_API_KEY: 're_test_key',
  ADMIN_EMAIL: 'admin@test.com',
  SITE_URL: 'https://test.netlify.app',
};

/** Apply all test env vars to process.env */
function setupEnv() {
  Object.assign(process.env, TEST_ENV);
}

/**
 * Configure https.request to return mock responses in order.
 * Each call to https.request consumes the next response in the array.
 *
 * @param {object} https - the jest-mocked https module
 * @param {Array<{statusCode: number, body: any}>} responses
 */
function mockHttpsSequence(https, responses) {
  let idx = 0;

  https.request.mockImplementation((options, callback) => {
    const resp = responses[idx++] || { statusCode: 200, body: {} };
    const mockRes = Object.assign(new EventEmitter(), { statusCode: resp.statusCode });

    const mockReq = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      end: jest.fn(() => {
        process.nextTick(() => {
          if (callback) callback(mockRes);
          process.nextTick(() => {
            const data =
              resp.body === null || resp.body === undefined
                ? ''
                : typeof resp.body === 'string'
                ? resp.body
                : JSON.stringify(resp.body);
            mockRes.emit('data', data);
            mockRes.emit('end');
          });
        });
      }),
    });

    return mockReq;
  });
}

module.exports = { TEST_ENV, setupEnv, mockHttpsSequence };
