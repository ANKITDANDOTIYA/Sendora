"use client";

import { useJoyride, STATUS } from "react-joyride";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import useAuthStore from "@/store/auth.store";
import AppPasswordModal from "./app-password-modal";
import TourTooltip from "./tour-tooltip";

const TourContext = createContext({
  isTourActive: false,
  currentStepIndex: 0,
  totalSteps: 8,
  skipTour: () => {},
  skipStep: () => {},
  nextStep: () => {},
  prevStep: () => {},
  startTour: () => {},
  restartTour: () => {},
  completeTour: () => {},
  registerDialogControl: () => {},
});

export const useTour = () => useContext(TourContext);

// Resolves once the selector exists in the DOM — lets `before` hooks block a
// step until its target has mounted instead of guessing with timeouts.
const waitForElement = (selector, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - start > timeout)
        return reject(new Error(`Timed out waiting for ${selector}`));
      requestAnimationFrame(check);
    };
    check();
  });

const TITLE_STEP = 1;
const DESC_STEP = 2;
const CREATE_STEP = 3;

// Color tokens + behavior flags — passed as `options` prop in v3
const joyrideOptions = {
  arrowColor: "#ffffff",
  backgroundColor: "#ffffff",
  overlayColor: "rgba(0, 0, 0, 0.55)",
  primaryColor: "#000000",
  textColor: "#111827",
  zIndex: 10000,
  buttons: ["close", "primary"],
  // Prevent overlay clicks from closing the tour — fixes Radix portal
  // dropdowns (Select, Combobox, etc.) that render outside the spotlight
  overlayClickAction: false,
};

// CSS overrides — passed as `styles` prop in v3
const joyrideStyles = {
  tooltip: {
    borderRadius: 0,
    border: "2px solid #000000",
    boxShadow: "4px 4px 0px 0px rgba(0,0,0,1)",
    padding: "0px",
  },
  tooltipTitle: {
    fontSize: "16px",
    fontWeight: "700",
    marginBottom: "8px",
  },
  tooltipContent: {
    fontSize: "14px",
    lineHeight: "1.6",
    padding: "0",
  },
  buttonPrimary: {
    backgroundColor: "#000000",
    borderRadius: 0,
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: "600",
    padding: "8px 16px",
  },
  buttonBack: {
    backgroundColor: "transparent",
    border: "1px solid #000000",
    borderRadius: 0,
    color: "#000000",
    fontSize: "13px",
    fontWeight: "600",
    padding: "8px 16px",
    marginRight: "8px",
  },
  buttonSkip: {
    color: "#6b7280",
    fontSize: "13px",
  },
  spotlight: {
    borderRadius: 0,
    border: "2px solid #000000",
  },
  buttonClose: {
    color: "#111827",
  },
};

export function TourProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, updateUser } = useAuthStore();
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const prevPathnameRef = useRef(pathname);

  // Ref keeps the latest stepIndex readable inside effects and callbacks without stale closures
  const stepIndexRef = useRef(0);
  useEffect(() => {
    stepIndexRef.current = stepIndex;
  }, [stepIndex]);

  // Dialog control registered from CreateCampaignDialog
  const dialogControlRef = useRef(null);
  const registerDialogControl = useCallback((control) => {
    dialogControlRef.current = control;
  }, []);

  const closeCreateDialog = useCallback(() => {
    if (dialogControlRef.current?.close) {
      dialogControlRef.current.close();
    }
  }, []);

  // Opens the create-campaign dialog if it isn't already, waiting until its
  // fields are mounted. Used by the dialog steps so the tour self-heals even if
  // the dialog was never opened (or got closed) before the step renders.
  const ensureCreateDialogOpen = useCallback(async () => {
    if (typeof document === "undefined") return;
    if (document.getElementById("title")) return;

    if (dialogControlRef.current?.open) {
      dialogControlRef.current.open();
    } else {
      document.getElementById("tour-new-campaign-btn")?.click();
    }
    await waitForElement("#title");
  }, []);

  const isOnCampaignDetail = /^\/campaigns\/[^/]+$/.test(pathname);

  const steps = useMemo(
    () => [
      {
        target: "#tour-new-campaign-btn",
        title: "Create Your First Campaign",
        content:
          "Welcome to Sendora! This button opens the campaign builder where you can start setting up email outreach sequences. Click Next to take a look, or skip at any time.",
        skipBeacon: true,
        placement: "bottom",
      },
      {
        target: "#title",
        title: "Campaign Title",
        content:
          'Give your campaign a clear name (e.g. "Q2 SaaS Outreach"). You can leave this blank for now and explore — all fields in this tour are completely optional.',
        skipBeacon: true,
        placement: "bottom",
        before: ensureCreateDialogOpen,
      },
      {
        target: "#desc",
        title: "Campaign Description",
        content:
          "Add notes about your target audience, value proposition, or goals for your reference. You can skip this and fill it out later whenever you like.",
        skipBeacon: true,
        placement: "top",
        before: ensureCreateDialogOpen,
      },
      {
        target: "#tour-create-campaign-submit",
        title: "Campaign Creation",
        content:
          "Clicking Create initializes the campaign with a pre-configured 4-email sequence. You don't need to create one now — click Next or Skip Step to keep exploring features without saving anything!",
        skipBeacon: true,
        placement: "top",
        before: ensureCreateDialogOpen,
      },
      {
        target: isOnCampaignDetail ? "#tour-tab-leads" : "body",
        title: "Leads Management",
        content:
          "The Leads tab is where you manage your contacts. Import leads via CSV files or add them individually. Sendora automatically sends emails to each contact along your sequence schedule.",
        skipBeacon: true,
        placement: isOnCampaignDetail ? "bottom" : "center",
      },
      {
        target: isOnCampaignDetail ? "#tour-tab-crm" : "body",
        title: "CRM Kanban Board",
        content:
          "Track deal progress on an interactive Kanban board. Move leads through stages as they open, click, and reply — from First Contact all the way to Closed Deal.",
        skipBeacon: true,
        placement: isOnCampaignDetail ? "bottom" : "center",
      },
      {
        target: isOnCampaignDetail ? "#tour-tab-builder" : "body",
        title: "Pitch Builder & Spintax",
        content:
          "Design multi-stage email sequences with AI assistance. Use spintax variations like {Hello|Hi|Hey} and personalized merge tags to maximize deliverability and avoid spam filters.",
        skipBeacon: true,
        placement: isOnCampaignDetail ? "bottom" : "center",
      },
      {
        target: isOnCampaignDetail ? "#tour-tab-analytics" : "body",
        title: "Analytics Dashboard",
        content:
          "Monitor opens, clicks, replies, and bounces in real time. Use these live metrics to fine-tune your outreach messaging, timing, and deliverability over time.",
        skipBeacon: true,
        placement: isOnCampaignDetail ? "bottom" : "center",
      },
    ],
    [isOnCampaignDetail, ensureCreateDialogOpen],
  );

  // Skip the full tour: immediate exit to dashboard, persist state, no blocking modal
  const skipTour = useCallback(() => {
    closeCreateDialog();
    setRun(false);
    setShowModal(false);
    updateUser({ tourCompleted: true });
    if (token) {
      fetch("/api/auth/complete-tour", {
        method: "POST",
        headers: { Authorization: token },
      }).catch((err) =>
        console.error("Failed to persist tour completion:", err),
      );
    }
    router.push("/dashboard");
  }, [closeCreateDialog, token, updateUser, router]);

  // Complete the full tour at the end
  const completeTour = useCallback(() => {
    closeCreateDialog();
    setRun(false);
    setShowModal(true);
    updateUser({ tourCompleted: true });
    if (token) {
      fetch("/api/auth/complete-tour", {
        method: "POST",
        headers: { Authorization: token },
      }).catch((err) =>
        console.error("Failed to persist tour completion:", err),
      );
    }
    router.push("/dashboard");
  }, [closeCreateDialog, token, updateUser, router]);

  // Advance to next step (or finish if at last step) — completely skippable, no validation
  const nextStep = useCallback(
    (currentIndex) => {
      const idx =
        typeof currentIndex === "number" ? currentIndex : stepIndexRef.current;
      if (idx === CREATE_STEP) {
        // Leaving dialog step without submitting: close dialog, advance smoothly
        closeCreateDialog();
        setStepIndex(CREATE_STEP + 1);
      } else if (idx >= steps.length - 1) {
        completeTour();
      } else {
        setStepIndex(idx + 1);
      }
    },
    [closeCreateDialog, completeTour, steps.length],
  );

  // Go to previous step
  const prevStep = useCallback(
    (currentIndex) => {
      const idx =
        typeof currentIndex === "number" ? currentIndex : stepIndexRef.current;
      if (idx === TITLE_STEP) {
        // Going back from Title (step 1) to Step 0: close the dialog so the button is highlighted
        closeCreateDialog();
        setStepIndex(0);
      } else if (idx > 0) {
        setStepIndex(idx - 1);
      }
    },
    [closeCreateDialog],
  );

  // Skip a single step without side effects
  const skipStep = useCallback(
    (currentIndex) => {
      const idx =
        typeof currentIndex === "number" ? currentIndex : stepIndexRef.current;
      if (idx === CREATE_STEP) {
        // Skipping Step 3: close dialog without submitting
        closeCreateDialog();
        setStepIndex(CREATE_STEP + 1);
      } else if (idx >= steps.length - 1) {
        completeTour();
      } else {
        setStepIndex(idx + 1);
      }
    },
    [closeCreateDialog, completeTour, steps.length],
  );

  // Restart / replay the tour
  const restartTour = useCallback(() => {
    closeCreateDialog();
    setStepIndex(0);
    router.push("/campaigns");
    setTimeout(() => {
      setRun(true);
    }, 800);
  }, [closeCreateDialog, router]);

  // Start the tour once for users who haven't finished it (DB-backed flag).
  // `startedRef` is set when the timer fires — not when scheduled — so React
  // StrictMode's mount→cleanup→mount (which clears the pending timer) still
  // reschedules instead of latching the guard and killing the tour.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !user || user.tourCompleted) return;
    const t = setTimeout(() => {
      startedRef.current = true;
      router.push("/campaigns");
      setTimeout(() => setRun(true), 800);
    }, 1200);
    return () => clearTimeout(t);
  }, [user, router]);

  // Detect navigation from the campaigns list → /campaigns/[id] after the
  // create dialog submits manually by the user
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    const isNowOnCampaignDetail = /^\/campaigns\/[^/]+$/.test(pathname);
    const wasOnCampaignsList = prev === "/campaigns";

    if (
      isNowOnCampaignDetail &&
      wasOnCampaignsList &&
      stepIndexRef.current <= CREATE_STEP
    ) {
      setTimeout(() => {
        setStepIndex(CREATE_STEP + 1);
        setRun(true);
      }, 800);
    }
  }, [pathname]);

  const handleEvent = useCallback(
    (data, controls) => {
      const { action, index, status, type } = data;

      if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
        skipTour();
        return;
      }

      if (type === "error:target_not_found") {
        console.warn("Tour target not found, moving to next step:", data);
        if (index >= steps.length - 1) {
          completeTour();
        } else {
          setStepIndex(index + 1);
        }
        return;
      }

      if (type === "error") {
        console.warn("Tour error occurred:", data);
        setRun(false);
        return;
      }

      if (type !== "step:after") return;

      if (action === "close") {
        skipTour();
        return;
      }

      if (action === "prev") {
        prevStep(index);
        return;
      }

      // Next / primary action
      nextStep(index);
    },
    [skipTour, completeTour, prevStep, nextStep, steps.length],
  );

  const { Tour } = useJoyride({
    continuous: true,
    run,
    stepIndex,
    steps,
    showProgress: true,
    showSkipButton: true,
    scrollToFirstStep: true,
    tooltipComponent: TourTooltip,
    options: joyrideOptions,
    styles: joyrideStyles,
    locale: {
      back: "Back",
      close: "Close",
      last: "Finish",
      next: "Next →",
      skip: "Skip tour",
    },
    onEvent: handleEvent,
  });

  return (
    <TourContext.Provider
      value={{
        isTourActive: run,
        currentStepIndex: stepIndex,
        totalSteps: steps.length,
        skipTour,
        skipStep,
        nextStep,
        prevStep,
        startTour: restartTour,
        restartTour,
        completeTour,
        registerDialogControl,
      }}
    >
      {Tour}
      {children}
      <AppPasswordModal open={showModal} onClose={() => setShowModal(false)} />
    </TourContext.Provider>
  );
}
