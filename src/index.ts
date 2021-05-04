import { Webhook, firestore, getPrice, iamport, logger, send } from './tools';
import dayjs, { Dayjs } from 'dayjs';

const rideCol = firestore.collection('ride');
const userCol = firestore.collection('users');

const maxLevel = Number(process.env.MAX_LEVEL || 4);
const maxCount = Number(process.env.MAX_COUNT || 100);
const sleep = (timeout: number) =>
  new Promise((resolve) => setTimeout(resolve, timeout));

interface User {
  uid: string;
  username: string;
  phone: string;
  birthday: Dayjs;
  billingKeys: string[];
}

interface Ride {
  rideId: string;
  branch: string;
  startedAt: Dayjs;
  endedAt: Dayjs;
  unpaied: boolean;
  repayTime: Dayjs;
  repayLevel: number;
  ref: string;
}

interface RideDetails {
  branch: string;
  cost: number;
  coupon: string;
  endedAt: Dayjs;
  kickboardName: string;
  kickboardId: string;
  payment?: string;
  startedAt: Dayjs;
}

async function main() {
  logger.info('시스템을 시작합니다.');
  await Webhook.send(`🤚 시스템을 시작합니다.`);

  let cursor = dayjs(0);
  let count = 0;
  while (true) {
    if (count >= maxCount) {
      await Webhook.send(`🚥 ${count}명에게 메세지를 전송하였습니다.`);
      logger.info(`[${cursor.toDate()}] 1일 처리량을 초과하여 중단합니다.`);
      break;
    }

    const { newCursor, users } = await getUsers(cursor);
    if (users.length <= 0) {
      logger.info(`[${cursor.toDate()}] 미수금 사용자를 모두 처리했습니다.`);
      process.exit(0);
    }

    logger.info(
      `[${cursor.toDate()}] 미수금 사용자 ${users.length}명을 찾았습니다.`
    );

    cursor = newCursor;
    for (const user of users) {
      if (count >= maxCount) break;

      const birthday = user.birthday.format('YYYY년 MM월 DD월');
      const username = user.username || '알 수 없음';
      const phone = user.phone || '전화번호 없음';
      user.username = user.username || '고객';
      logger.info(
        '==========================================================================='
      );

      const rides = await getUserRides(user.uid);
      logger.info(
        `${count} >> ${user.uid} - ${username}님 ${phone} ${birthday}`
      );

      for (const ride of rides) {
        try {
          const currentDate = dayjs().startOf('day');
          if (currentDate.diff(ride.repayTime.startOf('day'), 'days') < 7) {
            logger.info(`처리한지 일주일이 되지 않아 넘어갑니다.`);
            continue;
          }

          await upgradeLevel(user, ride);
          if (phone === '전화번호 없음') {
            logger.info(`이름 또는 전화번호가 올바르지 않습니다. 무시합니다.`);
            break;
          }

          const level = ride.repayLevel;
          const diff = ride.endedAt.diff(ride.startedAt, 'minutes');
          const price = await getPrice(ride.branch, diff);
          const startedAt = ride.startedAt.format('YYYY년 MM월 DD일 HH시 mm분');
          const endedAt = ride.endedAt.format('HH시 mm분');
          const usedAt = `${startedAt} ~ ${endedAt}(${diff}분)`;
          if (diff <= 2) {
            logger.info(`${diff}분 기록입니다. 무시합니다.`);
            continue;
          }

          const rideDetails = await getRide(ride.rideId);
          if (!rideDetails) {
            logger.info(`잘못된 데이터입니다. 무시합니다.`);
            continue;
          }

          if (rideDetails.payment) {
            logger.info(`이미 결제된 라이드입니다.`);
            continue;
          }

          logger.info(`${ride.branch} - ${usedAt}`);
          if (ride.repayLevel >= maxLevel) {
            logger.info(`이미 관리자에서 처리 중인 라이드 기록입니다.`);
            continue;
          }

          if (user.billingKeys) {
            logger.info(`사용자 정보에 빌링키가 존재하여 결제를 시도합니다.`);
            const result = await retryPay(user, ride, rideDetails, price);
            count++;
            if (result) {
              logger.info(
                `빌링키로 결제를 성공하여 결제 링크를 발송하지 않습니다.`
              );

              continue;
            }
          }

          const paymentURL = `https://repay.hikick.kr/${ride.rideId}`;
          logger.info(`결제 링크: ${paymentURL}`);
          const title =
            '마지막으로 이용하신 라이드가 정상적으로 결제되지 않았습니다.';
          const buttons = { 안내: paymentURL };
          const fields = {
            user,
            ride,
            rideDetails,
            usedAt,
            price: `${price.toLocaleString()}원`,
            paymentURL,
          };

          if (level < maxLevel - 1) {
            count++;
            await send(user.phone, 'TE_3356', title, fields, buttons);
            logger.info('문자를 전송하였습니다. (일반)');
            continue;
          }

          count++;
          await send(user.phone, 'TE_3357', title, fields, buttons);
          logger.info('문자를 전송하였습니다. (경고)');
        } catch (err) {
          logger.error('라이드 오류가 발생하였습니다. ' + err.message);
          logger.error(err.stack);
        }
      }
    }
  }
}

async function upgradeLevel(user: User, ride: Ride): Promise<void> {
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
  user: User,
  ride: Ride,
  rideDetails: RideDetails,
  price: number
): Promise<boolean> {
  try {
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
        logger.info(`결제에 성공하였습니다. (${billingKey})`);
        await setPaied(user, ride, merchantUid, price);
        const diff = ride.endedAt.diff(ride.startedAt, 'minutes');
        const startedAt = ride.startedAt.format('YYYY년 MM월 DD일 HH시 mm분');
        const endedAt = ride.endedAt.format('HH시 mm분');
        const usedAt = `${startedAt} ~ ${endedAt}(${diff}분)`;
        await send(
          user.phone,
          'TE_3355',
          `이용하신 킥보드(${rideDetails.kickboardName})가 자동으로 결제되었습니다.`,
          {
            user,
            usedAt,
            cardName: `${res.card_number} (${res.card_name})`,
            price: `${price.toLocaleString()}원`,
            rideDetails,
          }
        );

        await Webhook.send(
          `✅ ${user.username}님 빌링키 자동 결제를 완료하였습니다. ${price}원 / ${user.phone} / ${ride.branch}`
        );

        return true;
      }

      logger.info(`결제 실패, ${res.fail_reason}`);
      await sleep(3000);
    }

    return false;
  } catch (err) {
    logger.error('결제 오류가 발생하였습니다. ' + err.name);
    logger.error(err.stack);

    return true;
  }
}

async function setPaied(
  user: User,
  ride: Ride,
  merchantUid: string,
  price: number
): Promise<void> {
  const rideId = ride.ref.substr(5);
  await rideCol.doc(rideId).update({
    cost: price,
    payment: merchantUid,
    repayLevel: null,
    repayTime: null,
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
      .update({ unpaied: false, repayLevel: null, repayTime: null });
  }
}

async function getUserRides(uid: string): Promise<Ride[]> {
  const rides: Ride[] = [];
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
      rideId: data.ref.substr(5),
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

async function getUsers(
  cursor: Dayjs,
  limit = 100
): Promise<{
  newCursor: Dayjs;
  users: User[];
}> {
  const users: User[] = [];

  let newCursor = dayjs(0);
  const unpaiedRides = await getUnpaiedRides(cursor, limit);
  for (const ride of unpaiedRides) {
    newCursor = ride.end_time;
    const exists = users.find((uid) => ride.uid === uid);
    if (exists) {
      logger.warn(`${ride.uid} 중복 발견하였습니다.`);
      continue;
    }

    const user = await getUser(ride.uid);
    if (!user) {
      logger.warn(`${ride.uid} 사용자를 찾을 수 없습니다.`);
      continue;
    }

    users.push({
      uid: ride.uid,
      username: user.name,
      phone: user.phone,
      birthday: dayjs(user.birth._seconds * 1000),
      billingKeys: user.billkey,
    });
  }

  return { newCursor, users };
}

async function getRide(rideId: string): Promise<RideDetails | null> {
  const ride = await rideCol.doc(rideId).get();
  const data = ride.data();
  if (!data) return null;

  return {
    branch: data.branch,
    cost: data.cost,
    coupon: data.coupon,
    endedAt: dayjs(data.end_time._seconds * 1000),
    kickboardName: data.kick,
    kickboardId: data.kickName,
    payment: data.payment,
    startedAt: dayjs(data.start_time._seconds * 1000),
  };
}

async function getUser(uid: string): Promise<any> {
  const user = await userCol.doc(uid).get();
  return user.data();
}

async function getUnpaiedRides(cursor: Dayjs, limit = 100): Promise<any[]> {
  const rides: any[] = [];
  const unpaiedRides =
    process.env.NODE_ENV === 'prod'
      ? await rideCol
          .where('payment', '==', null)
          .where('end_time', '>', dayjs('2021-01-01').toDate())
          .orderBy('end_time', 'asc')
          .startAt(cursor.toDate())
          .limit(limit)
          .get()
      : await rideCol
          .where('uid', '==', 'Lf6lP5Pv1rTPViWUJwKvmMGPwHj2')
          .where('payment', '==', null)
          .limit(1)
          .get();

  logger.info(
    `[${cursor.toDate()}] 미결제 라이드 기록, ${
      unpaiedRides.size
    }개 발견하였습니다.`
  );

  unpaiedRides.forEach((ride) => rides.push(ride.data()));
  return rides;
}

async function getUserByPhone(phone: string): Promise<User | null> {
  let user = null;
  const users = await userCol.where('phone', '==', phone).limit(1).get();
  users.forEach((userDoc) => {
    const userData = userDoc.data();
    user = {
      uid: userDoc.id,
      username: userData.name,
      phone: userData.phone,
      birthday: dayjs(userData.birth._seconds * 1000),
      billingKeys: userData.billkey,
    };
  });

  return user;
}

async function setPaiedByPhone(phone: string): Promise<void> {
  const user = await getUserByPhone(phone);
  if (!user) {
    logger.error(`사용자를 찾을 수 없습니다.`);
    return;
  }

  logger.info(
    '==========================================================================='
  );

  logger.info(
    `${user.username}님 ${user.phone} ${user.birthday.format(
      'YYYY년 MM월 DD일'
    )}`
  );

  const rides = await getUserRides(user.uid);
  if (rides.length <= 0) {
    logger.info('- 미수금이 없습니다.');
    return;
  }

  for (const ride of rides) {
    const diff = ride.endedAt.diff(ride.startedAt, 'minutes');
    const price = await getPrice(ride.branch, diff);
    const startedAt = ride.startedAt.format('YYYY년 MM월 DD일 HH시 mm분');
    const endedAt = ride.endedAt.format('HH시 mm분');
    const usedAt = `${startedAt} ~ ${endedAt}(${diff}분, ${price.toLocaleString()}원)`;

    logger.info(`- ${usedAt}`);
    try {
      await setPaied(user, ride, `${Date.now()}`, price);
      await Webhook.send(
        `✅ ${user.username}님 미결제를 강제로 삭제하였습니다. ${usedAt} / ${user.phone} / ${ride.branch}`
      );
    } catch (err) {
      logger.error(err.message);
      logger.info(err.stack);
    }
  }
}

main();
