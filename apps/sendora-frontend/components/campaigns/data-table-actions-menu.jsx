"use client";

import { useState } from "react";
import {
  DotsHorizontalSquareIcon,
  EditIcon,
  TrashIcon,
} from "mage-icons-react/bulk";
import { Send, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import useSWRMutation from "swr/mutation";
import { remove } from "@/lib/apis";
import SendImmediatelyDialog from "./send-immediately-dialog";
import LeadDiagnosticsDialog from "./lead-diagnostics-dialog";

const DataTableActionsMenu = ({ obj }) => {
  const { id, name, email, stage, status, campaignId, campaignTitle, onEdit, onDelete } = obj || {};
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [diagnosticsDialogOpen, setDiagnosticsDialogOpen] = useState(false);

  // Strict email delivery rule: if lead is REPLIED (or terminal state), disallow sending
  const isReplied = status === "REPLIED";
  const isUnsendable = isReplied || status === "BOUNCED" || status === "UNSUBSCRIBED";

  // Setup mutation for deleting a lead
  const { trigger: deleteLead } = useSWRMutation("/api/lead/delete", remove, {
    onSuccess: () => {
      toast.success(`Lead ${name || email} removed successfully`);
      if (onDelete) onDelete(id);
    },
    onError: () => {
      toast.error(`Failed to remove lead ${name || email}`);
    },
  });

  const handleEdit = () => {
    if (onEdit) {
      onEdit(id);
    } else {
      toast.info(`Editing lead ${name || email}`);
    }
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to remove ${name || email}?`)) {
      if (onDelete) {
        onDelete(id);
      } else {
        deleteLead({ lead: id });
      }
    }
  };

  const leadData = {
    id,
    name,
    email,
    stage,
    status,
  };

  return (
    <>
      <div className="flex items-center gap-1 justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <DotsHorizontalSquareIcon className="w-4 h-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 border border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] bg-white">
            {/* If lead has replied or is unsendable, NEVER give option to send again */}
            {!isUnsendable && (
              <DropdownMenuItem
                onClick={() => setSendDialogOpen(true)}
                className="cursor-pointer font-medium"
              >
                <Send className="mr-2 h-4 w-4" />
                Send Test Email
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onClick={() => setDiagnosticsDialogOpen(true)}
              className="cursor-pointer font-medium"
            >
              <Info className="mr-2 h-4 w-4" />
              Delivery Diagnostics
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleEdit} className="cursor-pointer">
              <EditIcon className="mr-2 h-4 w-4" />
              Edit Lead
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleDelete} className="text-red-600 cursor-pointer">
              <TrashIcon className="mr-2 h-4 w-4" />
              Delete Lead
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!isUnsendable && (
        <SendImmediatelyDialog
          open={sendDialogOpen}
          setOpen={setSendDialogOpen}
          lead={leadData}
          campaignId={campaignId}
          campaignTitle={campaignTitle}
        />
      )}

      <LeadDiagnosticsDialog
        open={diagnosticsDialogOpen}
        setOpen={setDiagnosticsDialogOpen}
        lead={leadData}
        campaignId={campaignId}
        campaignTitle={campaignTitle}
      />
    </>
  );
};

export default DataTableActionsMenu;
