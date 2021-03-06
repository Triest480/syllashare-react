import React, { Component } from 'react';
import { Button, Grid, withStyles, Paper, Typography, Grow, Collapse, Fade, CircularProgress } from '@material-ui/core';
import PropTypes from 'prop-types';
import Login from './Login';
import SignUp from './SignUp';
import Code from './Code';
import ForgotPwd from './ForgotPwd';
import { GcpExports, AwsExports } from '../cloud/CloudExports';
import GoogleLogin from 'react-google-login';
import Amplify, { Auth, Hub, API, graphqlOperation } from 'aws-amplify';
import * as mutations from '../graphql/mutations';

API.configure(AwsExports);
Amplify.configure(AwsExports);

const styles = theme => ({
    root: {
        flexGrow: 1,
    },
    button: {
        margin: theme.spacing.unit,
    },
    container: {
        display: 'flex',
    },
    paper: {
        padding: theme.spacing.unit * 2,
        textAlign: 'center',
        color: theme.palette.text.secondary,
    },
    progress: {
        margin: theme.spacing.unit * 2,
    },
    googleLogin: {
        background: 'white',
        width: 'auto',
        height: 'auto',
        'border-width': '0px',
        'margin-bottom': '8px'
    }
});

class Authenticator extends Component {
    constructor(props) {
        super();
        this.state = {
            provider: null,
            syllaToken: null,
            loading: true,
            viewLogin: false,
            viewSignUp: false,
            viewForgotPwd: false,
            codeConfig: null
        };
    }

    initHubListener() {
        var hubListener = {
            onHubCapsule: (capsule) => {
                switch (capsule.payload.event) {
                    case 'signOut':
                        this.onSignOut();
                        break;
                }
            }
        }

        Hub.listen('auth', hubListener);
    }

    //Called on component initialization
    componentWillMount() {
        //Wait for google login to load
        window.gapi.load('auth2', () => 
        { 
            this.gAuth = window.gapi.auth2.init({
                client_id: GcpExports.clientID,
                scope: 'profile email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events'
            });
            this.gAuth.then(() => {
                //Check if a google user is logged in
                this.googleSignIn().catch(() => {
                    this.userPoolSignIn().catch(() => {
                        console.log("DEFAULT SIGN IN");
                        this.signIn(null, null).catch((err) => {
                            console.log("No sign in methods worked!");
                        });
                    });
                });
            }, (e) => {
                console.error("Google auth error: ", e);
            })
        });
        this.initHubListener();
    }

    onGoogleSignIn(gs) {
        this.gAuth.isSignedIn.listen(() => {
            this.googleSignIn().then((syllaToken) => {
                API.graphql(graphqlOperation(mutations.exchangeGoogleCode, { "code": gs.code })).then(() => {
                    console.log("REFRESH TOKEN SUBMITTED");
                }).catch((err) => {
                    console.error("ExchangeGoogleCode error:", err);
                });
            });
        });
    }

    googleSignIn() {
        return new Promise((resolve, reject) => {
            this.gAuth = window.gapi.auth2.getAuthInstance();
            if (this.gAuth.isSignedIn.get()) {
                var user = this.gAuth.currentUser.get();
                var idToken = user.getAuthResponse().id_token;

                //Sign in using saved id token
                this.signIn("accounts.google.com", idToken).then((syllaToken) => {
                    resolve(syllaToken);
                }).catch((err) => {
                    reject(err);
                });
            } else {
                reject();
            }
        });
    }
    
    onUserPoolSignIn(user, error) {
        if (error != null) {
            console.log("Sign in failed... Redirecting to login");
            this.setState({ viewLogin: true, viewSignUp: false, viewForgotPwd: false, codeConfig: null });
            return;
        }
        this.userPoolSignIn().then(() => {
            this.setState({ viewLogin: false, viewSignUp: false, viewForgotPwd: false, codeConfig: null });
        }).catch((err) => {
            this.setState({ viewLogin: true, viewSignUp: false, viewForgotPwd: false, codeConfig: null });
        });
    }

    userPoolSignIn() {
        return new Promise((resolve, reject) => {
            Auth.currentSession()
            .then(session => {
                console.log("USER POOL SIGN IN");
                this.getSyllaToken().then((syllaData) => {
                    var provider = "cognito";
                    this.props.onAuthenticated(syllaData["token"], syllaData["userID"], provider);
                    this.setState({
                        loading: false,
                        provider: provider,
                        syllaToken: syllaData["token"]
                    });
                    resolve(syllaData["token"]);
                });
            }).catch((err) => {
                reject(err);
            });
        });
    }

    signIn(provider, token) {
        return new Promise((resolve, reject) => {
            if (provider == null) {
                console.log("SIGNING IN");
                this.getSyllaToken().then((syllaData) => {
                    this.setState({
                        loading: false,
                        provider: provider,
                        syllaToken: syllaData["token"]
                    });
                    this.props.onAuthenticated(syllaData["token"], syllaData["userID"], provider);
                    resolve(syllaData["token"]);
                });
            } else {
                Auth.federatedSignIn(
                    // Initiate federated sign-in with Google identity provider 
                    provider,
                    { 
                        token: token
                    }
                ).then(() => {
                    console.log("FEDERATED SIGN IN");
                    this.getSyllaToken().then((syllaData) => {
                        this.setState({
                            loading: false,
                            provider: provider,
                            syllaToken: syllaData["token"]
                        });
                        this.props.onAuthenticated(syllaData["token"], syllaData["userID"], provider);
                        resolve(syllaData["token"]);
                    });
                });
            }
        });
    }

    //Exchanges federated identity token for a syllashare token that is easier for the backend to use
    getSyllaToken() {
        return new Promise((resolve, reject) => {
            API.graphql(graphqlOperation(mutations.exchangeToken)).then((resp) => {
                let data = resp.data.exchangeToken;
                resolve( { "token": data["token"], "userID": data["userID"] } );
            }).catch((err) => {
                console.error("ExchangeToken error:", err);
            });
        });
    }

    onSignOut() {
        this.setState({loading: true});
        if (this.gAuth.isSignedIn.get()) {
            this.gAuth.signOut().then(() => {
                this.signIn(null, null);
            });
        }
        this.signIn(null, null);
    }

    renderLoggedOut() {
        const { classes } = this.props;
        //You cannot pass a null react element so we use an empty div
        var otherOptionButton = <div />;
        if (this.state.viewLogin) {
            otherOptionButton = (<Button variant="contained" onClick={(evt) => { 
                    this.setState({ viewLogin: false, viewSignUp: true });
                    evt.stopPropagation();
                } }>
                Sign Up
            </Button>);
        } else if (this.state.viewSignUp) {
            otherOptionButton = (<Button variant="contained" onClick={(evt) => { 
                this.setState({ viewLogin: true, viewSignUp: false });
                evt.stopPropagation();
            }}>
                Login
            </Button>);
        }
        return (
            <div className={classes.root}>
                <Paper className={classes.paper} onClick={() => {this.setState({ viewLogin: false, viewSignUp: false, viewForgotPwd: false, codeConfig: null })}}>
                    <Typography variant="display1" gutterBottom>
                        Join SyllaShare!
                    </Typography>
                    
                    <GoogleLogin
                        className={classes.googleLogin}
                        clientId={GcpExports.clientID}
                        responseType="code"
                        accessType="offline"
                        scope="profile email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events"
                        uxMode="redirect"
                        redirect_uri="postmessage"
                        onSuccess={this.onGoogleSignIn.bind(this)}
                        onFailure={(e) => {console.error("Google sign in failure: ", e)}}>
                        <Button variant="contained" color="primary">
                            Google
                        </Button>
                    </GoogleLogin>
                    <br />
                    <Collapse in={!(this.state.viewLogin || this.state.viewSignUp)}>
                        <Grid container justify = "center" spacing={2}>
                            <Grid item xs={4} sm={2}>
                                <Button variant="contained" color="primary" onClick={(evt) => { 
                                        this.setState({ viewSignUp: true, viewForgotPwd: false, codeConfig: null }); 
                                        evt.stopPropagation();
                                    }} >
                                    Sign Up
                                </Button>
                            </Grid>
                            <Grid item xs={4} sm={2}>
                                <Button variant="contained" color="primary" onClick={(evt) => { 
                                        this.setState({ viewLogin: true, viewForgotPwd: false, codeConfig: null });
                                        evt.stopPropagation();
                                    } }>
                                    Login
                                </Button>
                            </Grid>
                        </Grid>
                    </Collapse>
                    <Fade in={this.state.viewLogin || this.state.viewSignUp}>
                        {otherOptionButton}
                    </Fade>
                </Paper>
                <br />
                <Collapse in={this.state.viewLogin}>
                    <Paper elevation={4} className={classes.paper}>
                        <Login onSignIn={this.onUserPoolSignIn.bind(this)} onCode={(codeConfig) => { this.setState({ codeConfig: codeConfig, viewLogin: false }); }} />
                        <br />
                        <Button variant="contained" onClick={() => { this.setState({ viewLogin: false, viewForgotPwd: true }); } }>
                            Forgot Password?
                        </Button>
                    </Paper>
                </Collapse>
                <Collapse in={this.state.viewSignUp}>
                    <Paper elevation={4} className={classes.paper}>
                        <SignUp onSignIn={this.onUserPoolSignIn.bind(this)} onCode={(codeConfig) => { this.setState({ codeConfig: codeConfig, viewSignUp: false }); }} />
                    </Paper>
                </Collapse>
                <Collapse in={this.state.viewForgotPwd}>
                    <Paper elevation={4} className={classes.paper}>
                        <ForgotPwd onCode={(codeConfig) => { this.setState({ codeConfig: codeConfig, viewForgotPwd: false }); }} />
                    </Paper>
                </Collapse>
                <Collapse in={this.state.codeConfig != null}>
                    <Paper elevation={4} className={classes.paper}>
                        <Code onSignIn={this.onUserPoolSignIn.bind(this)} config={this.state.codeConfig} />
                    </Paper>
                </Collapse>
            </div>
        );
    }

    render() {
        const { classes } = this.props;
        if (this.state.loading) {
            return (
                <Grid container
                spacing={0}
                direction="column"
                alignItems="center"
                justify="center">
                <CircularProgress className={classes.progress} size={50} />
            </Grid>);
        } else if (this.state.provider != null) {
            return (<div />)
        } else {
            return this.renderLoggedOut();
        }
    }
};

Authenticator.propTypes = {
    classes: PropTypes.object.isRequired
};

export default withStyles(styles)(Authenticator);