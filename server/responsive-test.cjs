const { chromium } = require("playwright");

const devices = [
  { name: "Small Mobile", width: 320, height: 700 },
  { name: "Mobile", width: 375, height: 812 },
  { name: "iPhone", width: 390, height: 844 },
  { name: "Large Mobile", width: 430, height: 932 },
  { name: "Tablet", width: 768, height: 1024 },
  { name: "iPad", width: 820, height: 1180 },
  { name: "iPad Landscape", width: 1180, height: 820 },
  { name: "Laptop", width: 1366, height: 768 },
  { name: "Desktop", width: 1440, height: 900 },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(process.argv[2] || "http://localhost:5173", {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    for (const device of devices) {
      await page.setViewportSize({
        width: device.width,
        height: device.height,
      });

      await page.waitForTimeout(500);

      const result = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      }));

      console.log(
        `${device.name}: ${
          result.horizontalOverflow ? "FAIL - Horizontal overflow" : "PASS"
        } (${device.width}px)`
      );
    }
  } catch (error) {
    console.error("Testing error:", error.message);
  } finally {
    await browser.close();
  }
})();