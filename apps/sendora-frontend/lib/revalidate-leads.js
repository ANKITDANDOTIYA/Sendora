import { mutate } from "swr";

/**
 * Revalidates all SWR cache entries related to a campaign's leads, contacts,
 * metrics, and overview:
 * - Paginated leads table (/api/contacts/paginatedapi) across all pages, search terms, and filters
 * - Leads growth chart (/api/contacts/leads-growth)
 * - Company filter chips (/api/contacts/companies)
 * - Contacts list (/api/contacts)
 * - CRM deals list (/api/crm/deals)
 * - Campaign overview (/api/campaign/[id] and /api/campaign)
 * - Dashboard stats (/api/dashboard/stats)
 *
 * @param {string} campaignId - The ID of the campaign whose data to revalidate
 */
export async function revalidateCampaignLeads(campaignId) {
  if (!campaignId) return;

  // 1. Revalidate all matching contacts/leads queries for this campaign (any query params)
  await mutate(
    (key) =>
      typeof key === "string" &&
      (key.includes("/api/contacts/paginatedapi") ||
        key.includes("/api/contacts/leads-growth") ||
        key.includes("/api/contacts/companies") ||
        key.includes("/api/crm/deals") ||
        (key.includes("/api/contacts") && !key.includes("/api/contacts/"))) &&
      key.includes(`campaign=${campaignId}`),
    undefined,
    { revalidate: true },
  );

  // 2. Revalidate campaign details and overview
  await mutate(`/api/campaign/${campaignId}`);
  await mutate("/api/campaign");

  // 3. Revalidate dashboard stats if present in cache
  await mutate(
    (key) => typeof key === "string" && key.includes("/api/dashboard/stats"),
    undefined,
    { revalidate: true },
  );
}

