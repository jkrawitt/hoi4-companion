import { useRouter } from 'vue-router'
import { completionDay, useCampaign } from '@/stores/campaign'

/**
 * Opens the overview showing the country on a date: what a plan row's date links to. An end date is
 * shown as the first whole day the thing counts as done (`completionDay`).
 */
export const useShowOnOverview = () => {
  const router = useRouter()
  const { viewDate } = useCampaign()
  return (date: Date) => {
    viewDate.value = completionDay(date)
    void router.push('/')
  }
}
