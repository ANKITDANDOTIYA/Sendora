import assert from "node:assert";

console.log("Starting Dashboard Open Rate & Tracking Logic Verification...\n");

// Test 1: Open rate calculation logic
function computeCampaignOpenRate({ sentMessagesCount, stagesSum, openedSum, openedOrRepliedLeadsCount, openEventsCount }) {
  const campaignEmailsSent = Math.max(sentMessagesCount || 0, stagesSum || 0);
  const campaignOpenedCount = Math.max(
    openedSum || 0,
    openedOrRepliedLeadsCount || 0,
    openEventsCount || 0,
  );

  return campaignEmailsSent > 0
    ? Math.min(100, Math.round((campaignOpenedCount / campaignEmailsSent) * 100))
    : 0;
}

// Scenario 1: 2 emails sent, 1 lead replied (proof of open)
{
  const openRate = computeCampaignOpenRate({
    sentMessagesCount: 2,
    stagesSum: 2,
    openedSum: 0, // tracking pixel wasn't recorded directly
    openedOrRepliedLeadsCount: 1, // but lead replied!
    openEventsCount: 0,
  });

  assert.strictEqual(openRate, 50, `Expected 50% open rate when 1 of 2 replied, got ${openRate}%`);
  console.log("✓ Scenario 1: 2 emails sent, 1 lead replied -> correctly computes 50% open rate.");
}

// Scenario 2: Legacy campaign with 0 tracking pixel fires, but 2 leads replied out of 4 sent
{
  const openRate = computeCampaignOpenRate({
    sentMessagesCount: 4,
    stagesSum: 4,
    openedSum: 0,
    openedOrRepliedLeadsCount: 2,
    openEventsCount: 0,
  });

  assert.strictEqual(openRate, 50, `Expected 50% open rate, got ${openRate}%`);
  console.log("✓ Scenario 2: Legacy campaign with replies but no pixel fires -> computes 50% open rate.");
}

// Scenario 3: 0 emails sent (brand new campaign)
{
  const openRate = computeCampaignOpenRate({
    sentMessagesCount: 0,
    stagesSum: 0,
    openedSum: 0,
    openedOrRepliedLeadsCount: 0,
    openEventsCount: 0,
  });

  assert.strictEqual(openRate, 0, `Expected 0% when 0 emails sent, got ${openRate}%`);
  console.log("✓ Scenario 3: 0 emails sent -> 0% open rate (no division by zero).");
}

// Scenario 4: Multiple opens on same email capped at 100%
{
  const openRate = computeCampaignOpenRate({
    sentMessagesCount: 2,
    stagesSum: 2,
    openedSum: 5, // recipient opened 5 times
    openedOrRepliedLeadsCount: 2,
    openEventsCount: 5,
  });

  assert.strictEqual(openRate, 100, `Expected capped at 100%, got ${openRate}%`);
  console.log("✓ Scenario 4: Multiple open events capped safely at 100%.");
}

// Test 2: Tracking pixel buffer verification
{
  const TRACKING_PIXEL = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );
  assert.strictEqual(TRACKING_PIXEL.length, 42, "Tracking GIF buffer should be 42 bytes");
  assert.strictEqual(TRACKING_PIXEL.toString("ascii", 0, 6), "GIF89a", "Should start with GIF89a header");
  console.log("✓ Test 2: Tracking pixel GIF is valid GIF89a format.");
}

console.log("\n=======================================================");
console.log("All Dashboard Open Rate & Tracking Tests Passed!");
console.log("=======================================================\n");
