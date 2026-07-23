<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Twig\Environment;

class DefaultController extends AbstractController
{
    #[Route('/', name: 'home', methods: ['GET'])]
    public function home(): Response
    {
        return $this->render('home.html.twig', ['page' => 'home']);
    }

    #[Route('/discography', name: 'discography', methods: ['GET'])]
    public function discography(): Response
    {
        return $this->render('discography.html.twig', ['page' => 'discography']);
    }

    #[Route('/musicians', name: 'musicians', methods: ['GET'])]
    public function musicians(): Response
    {
        return $this->render('musicians.html.twig', ['page' => 'musicians']);
    }

    #[Route('/tour', name: 'tour', methods: ['GET'])]
    public function tour(): Response
    {
        return $this->render('tour.html.twig', ['page' => 'tour']);
    }

    #[Route('/merch', name: 'merch', methods: ['GET'])]
    public function merch(): Response
    {
        return $this->render('merch.html.twig', ['page' => 'merch']);
    }

    // Individual song pages. {album}/{song} are constrained to slugs so the
    // template path can't be used for directory traversal; a missing template
    // returns a clean 404 instead of a 500.
    #[Route('/discography/{album}/{song}', name: 'discography_song', methods: ['GET'],
        requirements: ['album' => '[a-z0-9-]+', 'song' => '[a-z0-9-]+'])]
    public function discographySong(string $album, string $song, Environment $twig): Response
    {
        $template = "discography/albums/{$album}/{$song}.html.twig";

        if (!$twig->getLoader()->exists($template)) {
            throw new NotFoundHttpException('Song not found.');
        }

        return $this->render($template, ['page' => 'discography']);
    }
}
