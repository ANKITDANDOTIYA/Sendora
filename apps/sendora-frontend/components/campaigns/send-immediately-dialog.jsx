"use client";

import { useState } from "react";
import { mutate } from "swr";
import useAuthStore from "@/store/auth.store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import instance from "@/lib/axios";
import { revalidateCampaignLeads } from "@/lib/revalidate-leads";
import {
  Send,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export default function SendImmediatelyDialog({
  open,
  setOpen,
  lead,
  campaignId,
  campaignTitle,
  onSuccess,
}) {
  const { user, updateUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Strict email delivery rule: do not allow sending to replied or bounced leads
  const isReplied = lead?.status === "REPLIED";
  const isUnsendable = isReplied || lead?.status === "BOUNCED" || lead?.status === "UNSUBSCRIBED";

  const handleClose = () => {
    setOpen(false);
    setResult(null);
  };

  const handleSend = async () => {
    if (!lead || !campaignId || isUnsendable) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await instance.post(
        `/api/campaign/${campaignId}/lead/${lead.id}/send-immediately`,
        { isTestOnly: true },
      );

      setResult({
        success: true,
        data: res,
      });

      // Dynamically decrease credit: 1 credit per sent email
      if (typeof res?.remainingCredits === "number") {
        updateUser({ credits: res.remainingCredits });
      } else {
        updateUser({ credits: Math.max(0, (user?.credits || 0) - 1) });
      }
      mutate("/api/user/view");

      toast.success(`Test email sent to ${lead.email} successfully!`);
      revalidateCampaignLeads(campaignId);
      if (onSuccess) onSuccess(res);
    } catch (error) {
      const errorData = error.response?.data || {};
      setResult({
        success: false,
        error: {
          reason: errorData.reason || "SMTP Delivery Failed",
          details: errorData.details || error.message || "Failed to deliver email through SMTP transport.",
          code: errorData.errorCode || error.code || "ESMTP",
        },
      });

      toast.error(errorData.details || "Failed to send email to lead.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            <DialogTitle className="text-xl font-bold">
              Send Test Email
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-gray-600">
            Dispatch an immediate test email to verify your SMTP connection and recipient inbox delivery.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {/* Target details */}
          <div className="p-3 bg-gray-50 border border-black space-y-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Recipient:</span>
              <span className="font-semibold text-black">{lead?.email}</span>
            </div>
            {lead?.name && (
              <div className="flex justify-between">
                <span className="text-gray-500 font-medium">Lead Name:</span>
                <span className="font-medium text-black">{lead.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Campaign:</span>
              <span className="font-medium text-black truncate max-w-[260px]">
                {campaignTitle || campaignId}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 font-medium">Current Stage:</span>
              <span className="font-semibold text-black">
                Stage {lead?.stage || 0}
              </span>
            </div>
          </div>

          {/* Replied warning or Single Test Info */}
          {isReplied ? (
            <div className="p-3 bg-blue-50 border border-blue-400 text-blue-900 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-sm">
                <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Lead Has Replied</span>
              </div>
              <p>
                This lead has already replied to your campaign email. To comply with email sending rules and prevent spam flags, sending emails to replied leads is strictly prohibited.
              </p>
            </div>
          ) : isUnsendable ? (
            <div className="p-3 bg-red-50 border border-red-400 text-red-900 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-sm">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>Sending Disabled ({lead?.status})</span>
              </div>
              <p>Emails cannot be sent to leads in terminal state {lead?.status}.</p>
            </div>
          ) : (
            <div className="p-3 bg-gray-50 border border-black space-y-1 text-xs">
              <span className="font-bold text-black block">Single Test Action</span>
              <span className="text-gray-600 block">
                Dispatches the stage {lead?.stage || 0} pitch template through your connected SMTP mailbox to verify inbox deliverability. Campaign stage progression and user credits remain preserved.
              </span>
            </div>
          )}

          {/* Result Alert */}
          {result && (
            <div
              className={`p-3 border text-xs space-y-1.5 ${
                result.success
                  ? "bg-green-50 border-green-600 text-green-900"
                  : "bg-red-50 border-red-600 text-red-900"
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold text-sm">
                {result.success ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>SMTP Accepted Message</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <span>{result.error.reason}</span>
                  </>
                )}
              </div>

              {result.success ? (
                <>
                  <p>
                    <strong>Message ID:</strong>{" "}
                    <code className="bg-green-100 px-1 py-0.5 rounded break-all">
                      {result.data?.messageId || "N/A"}
                    </code>
                  </p>
                  <p>
                    <strong>Mailbox:</strong> {result.data?.credentialUsed || "Connected SMTP"}
                  </p>
                  <p>
                    <strong>Response:</strong> {result.data?.smtpResponse || "250 OK"} ({result.data?.durationMs}ms)
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">{result.error.details}</p>
                  {result.error.code && (
                    <p className="text-[11px] text-red-700">
                      Code: <code>{result.error.code}</code>
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={loading}
            className="border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            {result?.success ? "Done" : "Cancel"}
          </Button>

          <Button
            type="button"
            onClick={handleSend}
            disabled={loading || isUnsendable}
            className="border-black bg-black text-white hover:bg-gray-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
          >
            {loading ? "Sending Test..." : result?.success ? "Send Test Again" : "Send Test Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
