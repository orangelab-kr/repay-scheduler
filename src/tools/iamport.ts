// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Iamport from 'iamport';

export const iamport = new Iamport({
  impKey: process.env.IMP_KEY,
  impSecret: process.env.IMP_SECRET,
});
