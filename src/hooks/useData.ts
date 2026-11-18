import { useLiveQuery } from 'dexie-react-hooks';
import { loadDataset } from '../analytics/loader';
import type { Dataset, DateRange } from '../analytics/engine';

/** Live dataset for one student & range — recomputes whenever IndexedDB changes. */
export function useDataset(studentId: string | undefined, range: DateRange): Dataset | undefined {
  return useLiveQuery(() => (studentId ? loadDataset(studentId, range) : undefined), [studentId, range.from, range.to]);
}
