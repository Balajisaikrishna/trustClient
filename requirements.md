# Problem Statement
<!-- I got the idea of building this platform based on the problems my friends who freelance faced
The main problem with the clients while freelancing is that they ghost the freelancers after receiving the project files and flee without paying them back and vice versa.
This distrust and doubt between the client and the freelancer is real. 
This is a real problem because of which the clients and the freelancers hesitate doing business with new and unknown people.
This is a loss of opportunity to earn for a freelancer and a quality product for the client just because of the distrust.
So this is the platform on which the client can view the project before paying and the freelancer getting the money guaranteed, after which the client can get the files. -->
Solving the distrust between the client and the freelancer regarding payment and project handover.

# Who are the users?
There are two different categories of user

>- Freelancer : The user selling his project online (has an account)
>- Client : The user buying the product (no account — accesses everything via a private link)

# Core user flow

## Freelancer
Sign up/Log in 
    |
Verification of the Email ID
    |
Links his Razorpay account
    |
Uploads file to sell
    |
Sets the price
    |
Enters the client's email address
    |
System generates a watermarked preview
    |
System generates a unique, private link for this project
    |
System emails the link to the client

## Client (no account, no login)
Receives an email with a private project link
    |
Opens the link
    |
Sees the watermarked preview
    |
Sees the price
    |
Enters payment + email (for receipt)
    |
Pays
    |
Same link now shows a download option for the original file

# Scope of V1
>- Sign up/Log in for freelancer only
>- Freelancer linking his Razorpay account
>- Freelancer uploading a file and setting a price
>- Freelancer entering client's email to generate + send a private link
>- Generating watermarked preview content
>- Client viewing the watermarked preview via the private link (no login)
>- Client paying via the private link
>- Client downloading the original file via the same link after payment

# Out of scope for v1
>- Client accounts / client login
>- Public browsing or searching of projects
>- Chat page between the freelancer and the client
>- Refund policy and app crash handling
>- Menu tabs to check history and total money made etc.