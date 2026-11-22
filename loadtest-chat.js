import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    chat_test: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: 10,
      maxDuration: '5m',
    },
  },
};

export default function () {
  const requestId = `loadtest10-${__VU}-${Date.now()}`;

  const payload = JSON.stringify({
    message: 'Explain artificial intelligence in simple words.',
    requestId: requestId,
  });

  const response = http.post(
    'http://localhost:3001/api/chat',
    payload,
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: '130s',
    }
  );

  check(response, {
    'status is 200 or 202': (r) => r.status === 200 || r.status === 202,
    'response has answer or processing status': (r) => {
      try {
        const data = r.json();
        return Boolean(data.answer) || data.status === 'processing';
      } catch (_) {
        return false;
      }
    },
  });
}
