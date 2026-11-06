"use client";

import { Button } from "@/components/ui/button";
import { CancelIcon } from "mage-icons-react/stroke";
import { useTour } from "./tour-provider";

export default function TourTooltip({
  index,
  isLastStep,
  size,
  step,
  tooltipProps,
}) {
  const { skipStep, skipTour, nextStep, prevStep } = useTour();
  const currentStepNum = index + 1;

  return (
    <div
      {...tooltipProps}
      className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-5 max-w-sm sm:max-w-md w-full text-black select-none z-[10001]"
      style={{ minWidth: "300px" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {step.title && (
            <h3 className="text-base font-bold text-black leading-tight">
              {step.title}
            </h3>
          )}
          <span className="text-[11px] font-bold px-2 py-0.5 bg-gray-100 border border-black text-black tracking-wider uppercase">
            Step {currentStepNum} of {size}
          </span>
        </div>

        <button
          type="button"
          onClick={skipTour}
          className="p-1 hover:bg-gray-100 border border-transparent hover:border-black transition-colors shrink-0 text-black cursor-pointer"
          aria-label="Skip tour"
          title="Skip tour"
        >
          <CancelIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="text-sm text-gray-700 leading-relaxed mb-5">
        {step.content}
      </div>

      {/* Footer / Actions */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-200">
        <button
          type="button"
          onClick={skipTour}
          className="text-xs font-semibold text-gray-500 hover:text-black underline underline-offset-4 transition-colors cursor-pointer"
        >
          Skip Tour
        </button>

        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => prevStep(index)}
              className="text-xs h-8 px-3 border-black cursor-pointer"
            >
              Back
            </Button>
          )}

          {!isLastStep && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => skipStep(index)}
              className="text-xs h-8 px-3 border-black bg-gray-50 hover:bg-gray-100 cursor-pointer"
            >
              Skip Step
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            onClick={() => nextStep(index)}
            className="text-xs h-8 px-3 bg-black text-white hover:bg-black/90 cursor-pointer"
          >
            {isLastStep ? "Finish" : "Next →"}
          </Button>
        </div>
      </div>
    </div>
  );
}

