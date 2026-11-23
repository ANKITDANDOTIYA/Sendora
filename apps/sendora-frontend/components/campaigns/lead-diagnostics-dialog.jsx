"use client";

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import fetcher from "@/lib/fetcher";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import StatusChip from "@/components/ui/status-chip";
import { DateTime } from "luxon";
import {
  Info,
  CheckCircle2,
  AlertCircle,
  Send,
  Clock,
  Mail,
  RefreshCw,
} from "lucide-react";
import SendImmediatelyDialog from "./send-immediately-dialog";

export default function LeadDiagnosticsDialog({
  open,
  setOpen,
  lead,
  campaignId,
  campaignTitle,
}) {
  const [sendDialogOpen, setSendDialogOpen] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    open && lead?.id
      ? `/api/campaign/${campaignId}/lead/${lead.id}/diagnostics`
      : null,
    fetcher,
  );

  const diagnostics = data?.diagnostics;
  const isReplied =
    lead?.status === "REPLIED" ||
    diagnostics?.lead?.status === "REPLIED" ||
    diagnostics?.lead?.isReplied;
  const isLocked = diagnostics?.concurrency?.isLocked;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[650px] max-h-[85vh] overflow-y-auto border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white p-6">
          <DialogHeader className="pb-3 border-b border-black">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Info className="w-5 h-5" />
                  <DialogTitle className="text-xl font-bold">
                    Lead Delivery Diagnostics
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs text-gray-600 mt-1">
                  Full lifecycle visibility: scheduler eligibility, delivery gating, SMTP credentials, and message timeline.
                </DialogDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    mutate();
                    globalMutate("/api/user/view");
                  }}
                  disabled={isLoading}
                  className="h-8 px-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-xs"
                  title="Refresh diagnostics"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                </Button>

                {/* If email is replied, do not show any option to send */}
                {isReplied ? (
                  <span className="h-8 px-2.5 inline-flex items-center text-xs font-semibold bg-blue-100 text-blue-900 border border-blue-400">
                    Replied (Sending Disabled)
                  </span>
                ) : isLocked ? (
                  <span className="h-8 px-2.5 inline-flex items-center text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-400 animate-pulse">
                    Send in Progress...
                  </span>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setSendDialogOpen(true)}
                    className="h-8 bg-black text-white hover:bg-gray-800 text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send Test Email
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          {isLoading ? (
            <div className="py-12 text-center text-sm text-gray-500">
              Loading delivery diagnostics...
            </div>
          ) : error || !diagnostics ? (
            <div className="py-8 text-center text-sm text-red-600">
              {error?.message || "Failed to load diagnostic information for this lead."}
            </div>
          ) : (
            <div className="space-y-5 pt-2 text-sm">
              {/* Lead & Campaign Overview Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-gray-50 border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-xs">
                <div>
                  <span className="text-gray-500 block">Recipient</span>
                  <span className="font-bold truncate block" title={diagnostics.lead.email}>
                    {diagnostics.lead.email}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block">Current Status</span>
                  <div className="mt-0.5">
                    <StatusChip status={diagnostics.lead.status} />
                  </div>
                </div>
                <div>
                  <span className="text-gray-500 block">Stage Progress</span>
                  <span className="font-bold block mt-0.5">
                    Stage {diagnostics.lead.stage} / {diagnostics.campaign.maxStageCount}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block">User Credits</span>
                  <span className="font-bold block mt-0.5">
                    {diagnostics.campaign.userCredits} credits
                  </span>
                </div>
              </div>

              {/* 1. Scheduler Eligibility Section */}
              <div className="border border-black p-4 bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm uppercase tracking-wide flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    Scheduler Qualification
                  </h4>

                  {diagnostics.schedulerEligibility.isEligible ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 border border-green-500 px-2 py-0.5 rounded">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Eligible for Scheduled Send
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-500 px-2 py-0.5 rounded">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Skipped by Scheduler
                    </span>
                  )}
                </div>

                {/* Reason Banner if Skipped */}
                {diagnostics.schedulerEligibility.skipReason && (
                  <div className="p-2.5 bg-amber-50 border border-amber-300 text-xs text-amber-900 rounded-none flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block">Why is this lead waiting?</span>
                      <span>{diagnostics.schedulerEligibility.skipReason}</span>
                    </div>
                  </div>
                )}

                {/* Checklist of Gates */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                  <CheckItem
                    label="Campaign Status Active"
                    passed={diagnostics.schedulerEligibility.checks.campaignStatusOk}
                    detail={diagnostics.campaign.status}
                  />
                  <CheckItem
                    label="SMTP Account Connected"
                    passed={diagnostics.schedulerEligibility.checks.smtpCredentialsOk}
                    detail={`${diagnostics.campaign.configuredCredentialsCount} mailbox(es)`}
                  />
                  <CheckItem
                    label="User Credits Available"
                    passed={diagnostics.schedulerEligibility.checks.userCreditsOk}
                    detail={`${diagnostics.campaign.userCredits} left`}
                  />
                  <CheckItem
                    label="Active Day Today"
                    passed={diagnostics.schedulerEligibility.checks.activeDayOk}
                    detail={DateTime.fromISO(diagnostics.schedulerEligibility.currentTimeInUserTz).weekdayLong}
                  />
                  <CheckItem
                    label="Delivery Period Window"
                    passed={diagnostics.schedulerEligibility.checks.deliveryWindowOk}
                    detail={`${diagnostics.campaign.emailDeliveryPeriod} (${DateTime.fromISO(diagnostics.schedulerEligibility.currentTimeInUserTz).toFormat("HH:mm")})`}
                  />
                  <CheckItem
                    label="Follow-up Delay Elapsed"
                    passed={diagnostics.schedulerEligibility.checks.followUpDelayOk}
                    detail={diagnostics.lead.stage === 0 ? "Initial send" : `Stage ${diagnostics.lead.stage}`}
                  />
                  <CheckItem
                    label="Inbound Reply"
                    passed={diagnostics.schedulerEligibility.checks?.notReplied ?? !isReplied}
                    detail={isReplied ? "Reply Received (Sending Blocked)" : "No Reply (Eligible to Send)"}
                  />
                  <CheckItem
                    label="No Concurrency Lock"
                    passed={diagnostics.schedulerEligibility.checks?.noConcurrentSend ?? !isLocked}
                    detail={isLocked ? "Lock active" : "Idle"}
                  />
                </div>
              </div>

              {/* 2. Assigned SMTP Mailbox */}
              <div className="border border-black p-4 bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] space-y-2">
                <h4 className="font-bold text-sm uppercase tracking-wide flex items-center gap-1.5">
                  <Mail className="w-4 h-4" />
                  Assigned SMTP Mailbox
                </h4>

                {diagnostics.smtpCredential ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-gray-50 p-2.5 border border-black">
                    <div>
                      <span className="text-gray-500 block">Sender Address</span>
                      <span className="font-semibold block truncate" title={diagnostics.smtpCredential.email}>
                        {diagnostics.smtpCredential.email}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Host & Port</span>
                      <span className="font-semibold block">
                        {diagnostics.smtpCredential.host}:{diagnostics.smtpCredential.port} ({diagnostics.smtpCredential.secure ? "SSL" : "TLS"})
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Daily Limit</span>
                      <span className="font-semibold block">
                        {diagnostics.smtpCredential.dailyLimit} emails/day
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Sent Today</span>
                      <span className="font-semibold block">
                        {diagnostics.smtpCredential.sentToday} sent
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 italic">
                    No mailbox currently assigned to this lead. A random mailbox from the campaign will be assigned on first send.
                  </p>
                )}
              </div>

              {/* 3. Delivery Lifecycle & History */}
              <div className="border border-black p-4 bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] space-y-3">
                <h4 className="font-bold text-sm uppercase tracking-wide">
                  Delivery Lifecycle Events
                </h4>

                {diagnostics.history.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">No events recorded yet.</p>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {diagnostics.history.map((evt, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2.5 p-2 bg-gray-50 border border-gray-200 text-xs"
                      >
                        <div className="mt-0.5">
                          {evt.status === "SUCCESS" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          ) : evt.status === "FAILED" ? (
                            <AlertCircle className="w-4 h-4 text-red-600" />
                          ) : (
                            <Clock className="w-4 h-4 text-blue-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-black">{evt.event}</span>
                            <span className="text-[11px] text-gray-500 shrink-0">
                              {DateTime.fromISO(evt.timestamp).toFormat("dd LLL yyyy, h:mm:ss a")}
                            </span>
                          </div>
                          {evt.details?.messageId && (
                            <p className="text-[11px] text-gray-600 truncate mt-0.5">
                              Message-ID: <code>{evt.details.messageId}</code>
                            </p>
                          )}
                          {evt.details?.mailbox && (
                            <p className="text-[11px] text-gray-600 mt-0.5">
                              Mailbox: {evt.details.mailbox}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {!isReplied && (
        <SendImmediatelyDialog
          open={sendDialogOpen}
          setOpen={setSendDialogOpen}
          lead={lead}
          campaignId={campaignId}
          campaignTitle={campaignTitle}
          onSuccess={() => mutate()}
        />
      )}
    </>
  );
}

function CheckItem({ label, passed, detail }) {
  return (
    <div className="flex items-center justify-between p-1.5 bg-gray-50 border border-gray-200">
      <div className="flex items-center gap-1.5 truncate">
        {passed ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        )}
        <span className="font-medium truncate">{label}</span>
      </div>
      {detail && (
        <span className="text-[11px] text-gray-500 shrink-0 ml-2">
          {detail}
        </span>
      )}
    </div>
  );
}
