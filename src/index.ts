import dayjs, { Dayjs } from 'dayjs';
import { firestore, getPrice, iamport, logger } from './tools';

const rideCol = firestore.collection('ride');
const userCol = firestore.collection('users');

const maxLevel = Number(process.env.MAX_LEVEL || 4);
const sleep = (timeout: number) =>
  new Promise((resolve) => setTimeout(resolve, timeout));

async function main() {
  logger.info('시스템을 시작합니다.');
  const users = await getUsers();
  logger.info(`미수금 사용자 ${users.length}명을 찾았습니다.`);
  for (const user of users) {
    const birthday = user.birthday.format('YYYY년 MM월 DD년');
    const username = user.username || '없음';
    const phone = user.phone || '전화번호 없음';
    logger.info(
      '==========================================================================='
    );

    const rides = await getUserRides(user.uid);
    logger.info(
      `${user.uid} - ${username}님 ${phone} ${birthday} (${rides.length}회)`
    );

    let totalPrice = 0;
    for (const ride of rides) {
      const currentDate = dayjs().startOf('day');
      if (currentDate.diff(ride.repayTime.startOf('day'), 'days') < 7) {
        logger.info(`처리한지 일주일이 되지 않아 넘어갑니다.`);
        continue;
      }

      await upgradeLevel(user, ride);
      const level = ride.repayLevel;
      const rideId = ride.ref.substr(5);
      const diff = ride.endedAt.diff(ride.startedAt, 'minutes');
      const price = await getPrice(ride.branch, diff);
      const startedAt = ride.startedAt.format('YYYY년 MM월 DD년 HH시 mm분');
      const endedAt = ride.endedAt.format('HH시 mm분');
      const usedAt = `${startedAt} ~ ${endedAt}(${diff}분, ${price.toLocaleString()}원)`;
      totalPrice += price;

      const paiedRide = await isPaiedRide(rideId);
      if (paiedRide) {
        logger.info(`이미 결제된 라이드입니다.`);
        continue;
      }

      logger.info(`${ride.branch} - ${usedAt}`);
      if (ride.repayLevel >= maxLevel) {
        // 알림톡을 보내지 않음
        logger.info(`이미 관리자에서 처리 중인 라이드 기록입니다.`);
        continue;
      }

      if (user.billingKeys) {
        logger.info(`빌링키가 존재하여 결제를 시도합니다.`);
        const result = await retryPay(user, ride, price);
        if (result) {
          logger.info(
            `빌링키로 결제를 성공하여 결제 링크를 발송하지 않습니다.`
          );

          continue;
        }
      }

      logger.info(`결제 링크: https://repay.hikick.kr/${rideId}`);

      if (level < maxLevel - 1) {
        // todo - 알림톡(일반 경고)
        logger.info('알림톡을 전송하였습니다. (일반)');
        continue;
      }

      // todo - 알림톡(경고)
      logger.info('알림톡을 전송하였습니다. (경고)');
    }

    logger.info(`총 결제 금액: ${totalPrice.toLocaleString()}원`);
  }
}

async function upgradeLevel(
  user: {
    uid: string;
    username: string;
    phone: string;
    birthday: Dayjs;
    billingKeys: string[];
  },
  ride: {
    branch: string;
    startedAt: Dayjs;
    endedAt: Dayjs;
    unpaied: boolean;
    repayTime: Dayjs;
    repayLevel: number;
    ref: string;
  }
): Promise<void> {
  const repayTime = new Date();
  const repayLevel = ++ride.repayLevel;
  const rideId = ride.ref.substr(5);
  await rideCol.doc(rideId).update({ repayTime, repayLevel });

  const userRides = await userCol
    .doc(user.uid)
    .collection('ride')
    .where('ref', '==', ride.ref)
    .get();

  let userRideId;
  userRides.forEach((ride) => (userRideId = ride.id));
  if (userRideId) {
    await userCol
      .doc(user.uid)
      .collection('ride')
      .doc(userRideId)
      .update({ repayTime, repayLevel });
  }
}

async function retryPay(
  user: {
    uid: string;
    username: string;
    phone: string;
    birthday: Dayjs;
    billingKeys: string[];
  },
  ride: {
    branch: string;
    startedAt: Dayjs;
    endedAt: Dayjs;
    unpaied: boolean;
    repayTime: Dayjs;
    repayLevel: number;
    ref: string;
  },
  price: number
): Promise<boolean> {
  const merchantUid = `${Date.now()}`;
  for (const billingKey of user.billingKeys) {
    const res = await iamport.subscribe.again({
      customer_uid: billingKey,
      merchant_uid: merchantUid,
      amount: price,
      name: ride.branch,
      buyer_name: user.username,
      buyer_tel: user.phone,
    });

    if (res.status === 'paid') {
      logger.info(`- ${billingKey} - 결제 성공`);
      // todo - 알림톡 (완료)
      await setPaied(user, ride, merchantUid, price);
      return true;
    }

    logger.info(`- ${billingKey} - 결제 실패 ${res.fail_reason}`);
    await sleep(3000);
  }

  return false;
}

async function setPaied(
  user: {
    uid: string;
    username: string;
    phone: string;
    birthday: Dayjs;
    billingKeys: string[];
  },
  ride: {
    branch: string;
    startedAt: Dayjs;
    endedAt: Dayjs;
    unpaied: boolean;
    repayTime: Dayjs;
    repayLevel: number;
    ref: string;
  },
  merchantUid: string,
  price: number
): Promise<void> {
  const rideId = ride.ref.substr(5);
  await rideCol.doc(rideId).update({
    cost: price,
    payment: merchantUid,
  });

  const userRides = await userCol
    .doc(user.uid)
    .collection('ride')
    .where('ref', '==', ride.ref)
    .get();

  let userRideId;
  userRides.forEach((ride) => (userRideId = ride.id));
  if (userRideId) {
    await userCol
      .doc(user.uid)
      .collection('ride')
      .doc(userRideId)
      .update({ unpaied: false });
  }
}

async function getUserRides(
  uid: string
): Promise<
  {
    branch: string;
    startedAt: Dayjs;
    endedAt: Dayjs;
    unpaied: boolean;
    repayTime: Dayjs;
    repayLevel: number;
    ref: string;
  }[]
> {
  const rides: {
    branch: string;
    startedAt: Dayjs;
    endedAt: Dayjs;
    unpaied: boolean;
    repayTime: Dayjs;
    repayLevel: number;
    ref: string;
  }[] = [];

  const rideDocs = await userCol
    .doc(uid)
    .collection('ride')
    .where('unpaied', '==', true)
    .orderBy('end_time', 'desc')
    .limit(1)
    .get();

  rideDocs.forEach((ride) => {
    const data = ride.data();
    rides.push({
      branch: data.branch,
      startedAt: dayjs(data.start_time._seconds * 1000),
      endedAt: dayjs(data.end_time._seconds * 1000),
      unpaied: data.unpaied,
      repayTime: dayjs(data.repayTime ? data.repayTime._seconds * 1000 : 0),
      repayLevel: data.repayLevel || 0,
      ref: data.ref,
    });
  });

  return rides;
}

async function getUsers(): Promise<
  {
    uid: string;
    username: string;
    phone: string;
    birthday: Dayjs;
    billingKeys: string[];
  }[]
> {
  const users: {
    uid: string;
    username: string;
    phone: string;
    birthday: Dayjs;
    billingKeys: string[];
  }[] = [];

  const unpaiedRides = await getUnpaiedRides();
  for (const ride of unpaiedRides) {
    const exists = users.find((uid) => ride.uid === uid);
    if (exists) {
      logger.warn(`${ride.uid} 중복 발견하였습니다.`);
      continue;
    }

    const user = await getUser(ride.uid);
    users.push({
      uid: ride.uid,
      username: user.name,
      phone: user.phone,
      birthday: dayjs(user.birth._seconds * 1000),
      billingKeys: user.billkey,
    });
  }

  return users;
}

async function isPaiedRide(rideId: string): Promise<boolean> {
  const ride = await rideCol.doc(rideId).get();
  const data = ride.data();

  if (!data) return true;
  if (data.payment !== null) return true;
  return false;
}

async function getUser(uid: string): Promise<any> {
  const user = await userCol.doc(uid).get();
  return user.data();
}

async function getUnpaiedRides(): Promise<any[]> {
  const rides: any[] = [];
  // const unpaiedRides = await rideCol
  //   .where('payment', '==', null)
  //   .where('end_time', '>', dayjs('2021-01-01').toDate())
  //   .limit(1)
  //   .get();

  const unpaiedRides = await rideCol
    .where('uid', '==', 'Lf6lP5Pv1rTPViWUJwKvmMGPwHj2')
    .where('payment', '==', null)
    .limit(1)
    .get();

  logger.info(`미결제 라이드 기록, ${unpaiedRides.size}개 발견하였습니다.`);
  unpaiedRides.forEach((ride) => rides.push(ride.data()));
  return rides;
}

main();
