import { InternalError } from './error';
import { OPCODE } from './opcode';
import { firestore } from './firestore';

const costCollection = firestore.collection('cost');

export async function getPrice(
  branch: string,
  minutes: number
): Promise<number> {
  let cost = await costCollection.doc(branch).get();
  let costData = cost.data();

  if (!costData) {
    cost = await costCollection.doc('서울').get();
    costData = cost.data();

    if (!costData) {
      throw new InternalError('오류가 발생하였습니다.', OPCODE.ERROR);
    }
  }

  let price = costData.startCost;
  const removedMinutes = minutes - costData.freeTime;
  if (removedMinutes <= 0) return price;
  price += costData.addedCost * removedMinutes;
  return price;
}
