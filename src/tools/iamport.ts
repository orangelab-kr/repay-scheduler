import Iamport from 'iamport';

export const iamport = new Iamport({
  impKey: String(process.env.IMP_KEY),
  impSecret: String(process.env.IMP_SECRET),
});
