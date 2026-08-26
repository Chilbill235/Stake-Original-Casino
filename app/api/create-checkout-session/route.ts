import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { priceId } = body;

    if (!priceId) {
      return NextResponse.json({ error: 'Price ID is required' }, { status: 400 });
    }

    // Safely determine the base URL for Vercel & local development
    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL 
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` 
      : `${protocol}://${host}`;

    // Create Checkout Session using the 'embedded_page' UI mode
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'payment',
      return_url: `${origin}/return?session_id={CHECKOUT_SESSION_ID}`,
    });

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to create checkout session.';
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}