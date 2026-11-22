import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 5,
  duration: "30s",
};

export default function () {
  const res = http.get("http://localhost:3001/api/health");

  check(res, {
    "HTTP 200": (r) => r.status === 200,
    "Health OK": (r) => r.json("ok") === true,
  });

  sleep(1);
}
