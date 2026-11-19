const UAParser = require('ua-parser-js');

function parseDevice(req, res, next) {
  const uaString = req.headers['user-agent'] || '';
  const parser = new UAParser(uaString);
  const ua = parser.getResult();

  // Determine OS
  let osName = ua.os.name || 'Unknown OS';
  if (ua.os.version) {
    osName += ` ${ua.os.version}`;
  }

  // Determine Browser
  let browserName = ua.browser.name || 'Unknown Browser';
  if (ua.browser.major) {
    browserName += ` ${ua.browser.major}`;
  }

  // Determine Device Type
  let deviceType = ua.device.type || 'desktop';
  if (!ua.device.type) {
    if (/Mobile|Android|iP(hone|od)/i.test(uaString)) {
      deviceType = 'mobile';
    } else if (/iPad|Tablet/i.test(uaString)) {
      deviceType = 'tablet';
    } else {
      deviceType = 'desktop';
    }
  }

  // IP Address extraction
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  if (typeof ip === 'string' && ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }

  // Screen resolution (from body or header if sent by frontend)
  const screenSize = req.body?.screenSize || req.headers['x-screen-size'] || 'Unknown';

  req.clientDevice = {
    os: osName,
    browser: browserName,
    deviceType,
    screenSize,
    ip,
    userAgent: uaString
  };

  next();
}

module.exports = { parseDevice };
