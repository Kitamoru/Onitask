import { redirect } from 'next/navigation';

export default function Page() {
  // Redirect to boards page (or wizard for new users)
  redirect('/boards/');
}