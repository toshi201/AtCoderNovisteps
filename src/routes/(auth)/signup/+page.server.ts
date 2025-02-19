// See:
// https://lucia-auth.com/guidebook/sign-in-with-username-and-password/sveltekit/
// https://superforms.rocks/get-started
import { superValidate } from 'sveltekit-superforms/server';
import { fail, redirect } from '@sveltejs/kit';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { LuciaError } from 'lucia';

import { authSchema } from '$lib/zod/schema';
import { auth } from '$lib/server/auth';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const session = await locals.auth.validate();

  if (session) {
    throw redirect(302, '/');
  }

  const form = await superValidate(null, authSchema);

  return { form: { ...form, message: '' } };
};

// FIXME: エラー処理に共通部分があるため、リファクタリングをしましょう。
export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(request, authSchema);

    if (!form.valid) {
      return fail(400, {
        form: {
          ...form,
          message:
            'アカウントを作成できませんでした。指定された条件を満たすようにユーザ名 / パスワードを修正してください。',
        },
      });
    }

    try {
      const user = await auth.createUser({
        key: {
          providerId: 'username', // auth method
          providerUserId: form.data.username.toLowerCase(), // unique id when using "username" auth method
          password: form.data.password, // hashed by Lucia
        },
        attributes: {
          username: form.data.username,
        },
      });

      const session = await auth.createSession({
        userId: user.userId,
        attributes: {},
      });

      locals.auth.setSession(session); // set session cookie
    } catch (e) {
      // this part depends on the database you're using
      // check for unique constraint error in user table
      // See:
      // https://www.prisma.io/docs/reference/api-reference/error-reference#prismaclientknownrequesterror
      // https://www.prisma.io/docs/concepts/components/prisma-client/handling-exceptions-and-errors
      // https://lucia-auth.com/basics/error-handling/
      if (
        (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') ||
        (e instanceof LuciaError && e.message === 'AUTH_DUPLICATE_KEY_ID')
      ) {
        return fail(400, {
          form: {
            ...form,
            message:
              'アカウントを作成できませんでした。指定されたユーザ名はすでに使用されているため、修正・変更してください。',
          },
        });
      }

      return fail(500, {
        form: {
          ...form,
          message: 'サーバでエラーが発生しました。本サービスの開発・運営チームに連絡してください。',
        },
      });
    }

    // redirect to
    // make sure you don't throw inside a try/catch block!
    throw redirect(302, '/');
  },
};
