import { InternalError } from './error';
import { OPCODE } from './opcode';
import { firestore } from './firebase';

const costCollection = firestore.collection('cost');
const costs: { [key: string]: any } = {};
const maxPrice = Number(process.env.MAX_PRICE) || 33000;

export async function getPrice(
  branch: string,
  minutes: number
): Promise<number> {
  const cost = await getBranch(branch);
  let price = cost.startCost;
  const removedMinutes = minutes - cost.freeTime;
  if (removedMinutes <= 0) return price;
  price += cost.addedCost * removedMinutes;
  if (price >= maxPrice) return maxPrice;
  return price;
}

export async function getBranch(branch: string): Promise<any> {
  if (costs[branch]) return costs[branch];
  let cost = await costCollection.doc(branch).get();
  let costData = cost.data();

  if (!costData) {
    cost = await costCollection.doc('서울').get();
    costData = cost.data();

    if (!costData) {
      throw new InternalError('오류가 발생하였습니다.', OPCODE.ERROR);
    }
  }

  return costData;
}
