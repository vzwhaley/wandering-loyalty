<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Slide-out contact drawer endpoint. The front end (public/js/contact-drawer.js)
 * POSTs JSON and expects JSON back — 200 on success, 422 for validation/CAPTCHA
 * failures (with a per-field `errors` map), 500 on mail failure. Mirrors the
 * moonwhale.media drawer: honeypot → Turnstile → validate → send.
 */
class ContactController extends AbstractController
{
    #[Route('/contact', name: 'contact', methods: ['POST'])]
    public function submit(
        Request $request,
        MailerInterface $mailer,
        HttpClientInterface $httpClient,
        #[Autowire('%env(CONTACT_EMAIL)%')] string $contactEmail,
        #[Autowire('%env(MAILER_FROM)%')] string $mailerFrom,
        #[Autowire('%env(CONTACT_SUBJECT)%')] string $subject,
        #[Autowire('%env(TURNSTILE_SECRET_KEY)%')] string $turnstileSecret,
    ): JsonResponse {
        $data = json_decode($request->getContent(), true) ?? $request->request->all();

        // Honeypot: real users never fill "website". Silently accept (look
        // successful to the bot) without sending anything.
        if (!empty($data['website'] ?? '')) {
            return new JsonResponse(['message' => 'Sent.']);
        }

        // Cloudflare Turnstile — verify server-side. Skipped only when no secret
        // is configured (local/dev), where the honeypot still applies.
        if ('' !== $turnstileSecret && !$this->turnstilePasses($httpClient, $turnstileSecret, (string) ($data['cf-turnstile-response'] ?? ''), $request)) {
            return new JsonResponse(['message' => 'CAPTCHA verification failed. Please try again.'], 422);
        }

        // Validate.
        $errors = [];
        $first = trim((string) ($data['first_name'] ?? ''));
        $last  = trim((string) ($data['last_name'] ?? ''));
        $mail  = trim((string) ($data['email'] ?? ''));
        $phone = trim((string) ($data['phone'] ?? ''));
        $msg   = trim((string) ($data['message'] ?? ''));

        if ('' === $first)                      $errors['first_name'] = ['First name is required.'];
        elseif (mb_strlen($first) > 100)        $errors['first_name'] = ['First name is too long.'];
        if ('' === $last)                       $errors['last_name'] = ['Last name is required.'];
        elseif (mb_strlen($last) > 100)         $errors['last_name'] = ['Last name is too long.'];
        if ('' === $mail)                       $errors['email'] = ['Email is required.'];
        elseif (!filter_var($mail, FILTER_VALIDATE_EMAIL)) $errors['email'] = ['Please enter a valid email.'];
        elseif (mb_strlen($mail) > 255)         $errors['email'] = ['Email is too long.'];
        if ('' !== $phone && mb_strlen($phone) > 50) $errors['phone'] = ['Phone is too long.'];
        if ('' === $msg)                        $errors['message'] = ['Please enter a message.'];
        elseif (mb_strlen($msg) > 5000)         $errors['message'] = ['Message is too long.'];

        if ($errors) {
            return new JsonResponse(['errors' => $errors], 422);
        }

        try {
            // HTML body in Arial (proportional font) rather than the monospace
            // default for plain text. htmlspecialchars escapes user input.
            $style = 'font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222;';
            $html = '<div style="' . $style . '">'
                . 'New contact from the Wandering Loyalty website<br><br>'
                . 'Name: ' . htmlspecialchars($first . ' ' . $last) . '<br>'
                . 'Email: ' . htmlspecialchars($mail) . '<br>'
                . 'Phone: ' . htmlspecialchars('' !== $phone ? $phone : '(not provided)') . '<br><br>'
                . 'Message:<br>' . nl2br(htmlspecialchars($msg))
                . '</div>';

            $email = (new Email())
                ->from($mailerFrom)
                ->to($contactEmail)
                ->replyTo(new Address($mail, $first . ' ' . $last))
                ->subject($subject)
                ->html($html);

            $mailer->send($email);
        } catch (\Throwable) {
            return new JsonResponse(['message' => 'Mail delivery failed.'], 500);
        }

        return new JsonResponse(['message' => 'Sent.']);
    }

    private function turnstilePasses(HttpClientInterface $httpClient, string $secret, string $token, Request $request): bool
    {
        if ('' === $token) {
            return false;
        }

        try {
            $response = $httpClient->request('POST', 'https://challenges.cloudflare.com/turnstile/v0/siteverify', [
                'body' => [
                    'secret' => $secret,
                    'response' => $token,
                    'remoteip' => (string) $request->getClientIp(),
                ],
                'timeout' => 10,
            ]);

            return (bool) ($response->toArray(false)['success'] ?? false);
        } catch (\Throwable) {
            return false;
        }
    }
}
