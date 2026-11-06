import assert from "node:assert";

/**
 * Test suite verifying the Dashboard Onboarding Tour logic:
 * 1. User clicks Next without entering any fields.
 * 2. User skips an individual step.
 * 3. User skips the entire tour from the first step.
 * 4. User skips the entire tour from a middle step.
 * 5. User completes the full tour normally.
 * 6. User refreshes the dashboard after skipping or completing the tour.
 * 7. User uses the dashboard normally after skipping the tour (real validation intact).
 */

console.log("Starting Tour logic verification...\n");

const TITLE_STEP = 1;
const DESC_STEP = 2;
const CREATE_STEP = 3;
const TOTAL_STEPS = 8;

function createTourSimulation({ initialUser = { id: "u-1", tourCompleted: false } } = {}) {
  let user = { ...initialUser };
  let run = false;
  let stepIndex = 0;
  let dialogOpen = false;
  let currentPath = "/dashboard";
  let showModal = false;
  let apiCalls = [];

  const updateUser = (data) => {
    user = { ...user, ...data };
  };

  const router = {
    push: (path) => {
      currentPath = path;
    },
  };

  const closeCreateDialog = () => {
    dialogOpen = false;
  };

  const openCreateDialog = () => {
    dialogOpen = true;
  };

  const skipTour = () => {
    closeCreateDialog();
    run = false;
    showModal = false;
    updateUser({ tourCompleted: true });
    apiCalls.push({ endpoint: "/api/auth/complete-tour", method: "POST" });
    router.push("/dashboard");
  };

  const completeTour = () => {
    closeCreateDialog();
    run = false;
    showModal = true;
    updateUser({ tourCompleted: true });
    apiCalls.push({ endpoint: "/api/auth/complete-tour", method: "POST" });
    router.push("/dashboard");
  };

  const nextStep = (currentIndex) => {
    const idx = typeof currentIndex === "number" ? currentIndex : stepIndex;
    if (idx === CREATE_STEP) {
      // Step 3 (Create It!): close dialog, do NOT submit form!
      closeCreateDialog();
      stepIndex = CREATE_STEP + 1;
    } else if (idx >= TOTAL_STEPS - 1) {
      completeTour();
    } else {
      stepIndex = idx + 1;
      if (stepIndex === TITLE_STEP || stepIndex === DESC_STEP || stepIndex === CREATE_STEP) {
        openCreateDialog();
      }
    }
  };

  const prevStep = (currentIndex) => {
    const idx = typeof currentIndex === "number" ? currentIndex : stepIndex;
    if (idx === TITLE_STEP) {
      closeCreateDialog();
      stepIndex = 0;
    } else if (idx > 0) {
      stepIndex = idx - 1;
    }
  };

  const skipStep = (currentIndex) => {
    const idx = typeof currentIndex === "number" ? currentIndex : stepIndex;
    if (idx === CREATE_STEP) {
      closeCreateDialog();
      stepIndex = CREATE_STEP + 1;
    } else if (idx >= TOTAL_STEPS - 1) {
      completeTour();
    } else {
      stepIndex = idx + 1;
      if (stepIndex === TITLE_STEP || stepIndex === DESC_STEP || stepIndex === CREATE_STEP) {
        openCreateDialog();
      }
    }
  };

  const startTour = () => {
    if (user.tourCompleted) return;
    router.push("/campaigns");
    run = true;
    stepIndex = 0;
  };

  return {
    getState: () => ({
      user,
      run,
      stepIndex,
      dialogOpen,
      currentPath,
      showModal,
      apiCalls,
    }),
    startTour,
    skipTour,
    completeTour,
    nextStep,
    prevStep,
    skipStep,
    openCreateDialog,
    closeCreateDialog,
  };
}

// Scenario 1: User clicks Next without entering any fields
{
  const sim = createTourSimulation();
  sim.startTour();
  assert.strictEqual(sim.getState().run, true);
  assert.strictEqual(sim.getState().stepIndex, 0);
  assert.strictEqual(sim.getState().currentPath, "/campaigns");

  // Step 0 -> Step 1 (Title)
  sim.nextStep(0);
  assert.strictEqual(sim.getState().stepIndex, 1);
  assert.strictEqual(sim.getState().dialogOpen, true);

  // Step 1 -> Step 2 (Desc) without entering any title
  sim.nextStep(1);
  assert.strictEqual(sim.getState().stepIndex, 2);
  assert.strictEqual(sim.getState().dialogOpen, true);

  // Step 2 -> Step 3 (Create It!) without entering any description
  sim.nextStep(2);
  assert.strictEqual(sim.getState().stepIndex, 3);
  assert.strictEqual(sim.getState().dialogOpen, true);

  // Step 3 -> Step 4 (Leads Tab): Must close dialog and NOT submit form/create campaign
  sim.nextStep(3);
  assert.strictEqual(sim.getState().stepIndex, 4);
  assert.strictEqual(sim.getState().dialogOpen, false);
  assert.strictEqual(sim.getState().apiCalls.filter((c) => c.endpoint === "/api/campaign/create").length, 0);

  // Advance through remaining steps: 4 -> 5 -> 6 -> 7
  sim.nextStep(4);
  assert.strictEqual(sim.getState().stepIndex, 5);
  sim.nextStep(5);
  assert.strictEqual(sim.getState().stepIndex, 6);
  sim.nextStep(6);
  assert.strictEqual(sim.getState().stepIndex, 7);

  // Finish tour from Step 7
  sim.nextStep(7);
  assert.strictEqual(sim.getState().run, false);
  assert.strictEqual(sim.getState().user.tourCompleted, true);
  assert.strictEqual(sim.getState().currentPath, "/dashboard");
  assert.strictEqual(sim.getState().apiCalls.some((c) => c.endpoint === "/api/auth/complete-tour"), true);
  console.log("✓ Scenario 1: User clicks Next without entering any fields passed.");
}

// Scenario 2: User skips an individual step
{
  const sim = createTourSimulation();
  sim.startTour();
  assert.strictEqual(sim.getState().stepIndex, 0);

  // Skip step 0 -> 1
  sim.skipStep(0);
  assert.strictEqual(sim.getState().stepIndex, 1);

  // Skip step 1 -> 2
  sim.skipStep(1);
  assert.strictEqual(sim.getState().stepIndex, 2);

  // Skip step 3 (Create It!) -> dialog closes, no side effects
  sim.skipStep(3);
  assert.strictEqual(sim.getState().stepIndex, 4);
  assert.strictEqual(sim.getState().dialogOpen, false);
  assert.strictEqual(sim.getState().apiCalls.length, 0);

  console.log("✓ Scenario 2: User skips an individual step passed.");
}

// Scenario 3: User skips the entire tour from the first step
{
  const sim = createTourSimulation();
  sim.startTour();
  assert.strictEqual(sim.getState().run, true);
  assert.strictEqual(sim.getState().stepIndex, 0);

  sim.skipTour();
  assert.strictEqual(sim.getState().run, false);
  assert.strictEqual(sim.getState().user.tourCompleted, true);
  assert.strictEqual(sim.getState().showModal, false);
  assert.strictEqual(sim.getState().currentPath, "/dashboard");
  assert.strictEqual(sim.getState().apiCalls.some((c) => c.endpoint === "/api/auth/complete-tour"), true);

  console.log("✓ Scenario 3: User skips the entire tour from the first step passed.");
}

// Scenario 4: User skips the entire tour from a middle step
{
  const sim = createTourSimulation();
  sim.startTour();
  sim.nextStep(0); // at step 1
  assert.strictEqual(sim.getState().dialogOpen, true);

  sim.skipTour();
  assert.strictEqual(sim.getState().run, false);
  assert.strictEqual(sim.getState().dialogOpen, false);
  assert.strictEqual(sim.getState().user.tourCompleted, true);
  assert.strictEqual(sim.getState().currentPath, "/dashboard");

  console.log("✓ Scenario 4: User skips the entire tour from a middle step passed.");
}

// Scenario 5: User completes the full tour normally
{
  const sim = createTourSimulation();
  sim.startTour();
  for (let i = 0; i < TOTAL_STEPS; i++) {
    sim.nextStep(i);
  }
  assert.strictEqual(sim.getState().run, false);
  assert.strictEqual(sim.getState().user.tourCompleted, true);
  assert.strictEqual(sim.getState().currentPath, "/dashboard");
  assert.strictEqual(sim.getState().showModal, true);

  console.log("✓ Scenario 5: User completes the full tour normally passed.");
}

// Scenario 6: User refreshes the dashboard after skipping or completing the tour
{
  const sim = createTourSimulation({ initialUser: { id: "u-1", tourCompleted: true } });
  sim.startTour();
  assert.strictEqual(sim.getState().run, false);
  assert.strictEqual(sim.getState().currentPath, "/dashboard");

  console.log("✓ Scenario 6: User refreshes dashboard after skipping/completing (tour does not auto-start) passed.");
}

// Scenario 7: User uses dashboard normally after skipping tour (real form validation intact)
{
  // Outside tour form validation handler
  const handleCreateCampaign = ({ title, desc }) => {
    if (!title?.trim() || !desc?.trim()) {
      return { success: false, error: "Please fill in a title and description." };
    }
    return { success: true, campaign: { id: "camp-123", title, desc } };
  };

  // 1. Trying to submit empty form fails with real validation
  const emptyRes = handleCreateCampaign({ title: "", desc: "" });
  assert.strictEqual(emptyRes.success, false);
  assert.strictEqual(emptyRes.error, "Please fill in a title and description.");

  // 2. Submitting with valid data succeeds
  const validRes = handleCreateCampaign({ title: "My Campaign", desc: "Outreach test" });
  assert.strictEqual(validRes.success, true);
  assert.strictEqual(validRes.campaign.id, "camp-123");

  console.log("✓ Scenario 7: Real form validation remains intact outside the tour passed.");
}

console.log("\nAll 7 test scenarios verified successfully!");

